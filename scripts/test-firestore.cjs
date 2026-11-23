const fs = require('fs');
const assert = require('node:assert/strict');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} = require('@firebase/rules-unit-testing');
const {
  doc, getDoc, updateDoc, collection, getDocs, writeBatch, setDoc
} = require('firebase/firestore');

(async () => {
  const env = await initializeTestEnvironment({
    projectId: 'demo-khetat-alitqan',
    firestore: {
      rules: fs.readFileSync('firestore.rules', 'utf8')
    }
  });

  try {
    const teacher = 'teacher-test';
    const student = 'student-test';
    const other = 'other-test';
    const ownRecord = 'record-one';
    const otherRecord = 'record-two';

    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();

      await Promise.all([
        ctx.firestore().collection('users').doc(teacher).set({
          uid: teacher, name: 'Test Teacher',
          role: 'teacher', email: 'teacher@test.invalid'
        }),
        ctx.firestore().collection('users').doc(student).set({
          uid: student, name: 'Test Student',
          role: 'student', studentId: ownRecord,
          studentNumber: '1001',
          email: 'student-1001@khetat-alitqan.firebaseapp.com'
        }),
        ctx.firestore().collection('students').doc(ownRecord).set({
          name: 'Test Student', teacherId: teacher,
          accountUid: student, records: [],
          createdAt: new Date()
        }),
        ctx.firestore().collection('students').doc(otherRecord).set({
          name: 'Another Student', teacherId: teacher,
          accountUid: other, records: [],
          createdAt: new Date()
        })
      ]);
    });

    const studentDb = env.authenticatedContext(student).firestore();
    const teacherDb = env.authenticatedContext(teacher).firestore();
    const guestDb = env.unauthenticatedContext().firestore();

    const own = doc(studentDb, 'students', ownRecord);
    const someoneElse = doc(studentDb, 'students', otherRecord);

    await assertSucceeds(getDoc(own));
    console.log('PASS: Student can read own record');

    await assertFails(getDoc(someoneElse));
    console.log('PASS: Student cannot read another record');

    await assertFails(updateDoc(own, { name: 'Changed' }));
    console.log('PASS: Student cannot edit own record');

    await assertFails(getDocs(collection(studentDb, 'students')));
    console.log('PASS: Student cannot list all students');

    await assertFails(getDoc(doc(guestDb, 'students', ownRecord)));
    console.log('PASS: Guest cannot read student record');

    await assertSucceeds(
      getDoc(doc(teacherDb, 'students', ownRecord))
    );
    console.log('PASS: Teacher can read assigned student');

    await assertFails(
      getDoc(doc(
        env.authenticatedContext('unrelated-teacher').firestore(),
        'students', ownRecord
      ))
    );
    console.log('PASS: Unrelated account cannot read record');

    // STUDENT_ACCOUNT_LINK_TEST_V1
    // Simulate a teacher linking a new Auth UID to an existing student.
    const newStudentId = 'unlinked-student';
    const newStudentUid = 'new-student-auth-uid';
    const newStudentNumber = '12345678';
    const newStudentEmail = 'student-' + newStudentNumber + '@khetat-alitqan.firebaseapp.com';
    await env.withSecurityRulesDisabled(async ctx => {
      await ctx.firestore().collection('students').doc(newStudentId).set({
        name: 'Unlinked Student', teacherId: teacher,
        records: [], createdAt: new Date()
      });
    });
    const linkBatch = writeBatch(teacherDb);
    linkBatch.update(doc(teacherDb, 'students', newStudentId), { accountUid: newStudentUid });
    linkBatch.set(doc(teacherDb, 'users', newStudentUid), {
      uid: newStudentUid, name: 'Unlinked Student',
      email: newStudentEmail, role: 'student',
      studentId: newStudentId, studentNumber: newStudentNumber,
      createdAt: new Date()
    });
    await assertSucceeds(linkBatch.commit());
    console.log('PASS: Teacher can atomically create and link student account');

    const linkedStudentDb = env.authenticatedContext(newStudentUid).firestore();
    await assertSucceeds(getDoc(doc(linkedStudentDb, 'students', newStudentId)));
    await assertFails(getDoc(doc(linkedStudentDb, 'students', ownRecord)));
    await assertFails(updateDoc(doc(linkedStudentDb, 'students', newStudentId), {name: 'Hacked'}));
    console.log('PASS: Linked student can only read their own record');

    // Another teacher must not claim the first teacher's student.
    const attackerUid = 'attacker-teacher';
    await env.withSecurityRulesDisabled(async ctx => {
      await ctx.firestore().collection('users').doc(attackerUid).set({
        uid: attackerUid, name: 'Attacker', role: 'teacher', email: 'attacker@test.invalid'
      });
    });
    const attackerDb = env.authenticatedContext(attackerUid).firestore();
    const badBatch = writeBatch(attackerDb);
    badBatch.update(doc(attackerDb, 'students', ownRecord), {accountUid: 'hijacked'});
    badBatch.set(doc(attackerDb, 'users', 'hijacked'), {
      uid: 'hijacked', name: 'Fake Student', role: 'student',
      studentId: ownRecord, studentNumber: '87654321',
      email: 'student-87654321@khetat-alitqan.firebaseapp.com',
      createdAt: new Date()
    });
    await assertFails(badBatch.commit());
    console.log('PASS: Another teacher cannot link an account to someone else student');

    console.log('ALL SECURITY READ TESTS PASSED');
  } finally {
    await env.cleanup();
  }
})().catch(err => {
  console.error('SECURITY TEST FAILED:', err);
  process.exitCode = 1;
});
