const fs = require('fs');
const assert = require('node:assert/strict');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} = require('@firebase/rules-unit-testing');
const {
  doc, getDoc, updateDoc, collection, getDocs
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

    console.log('ALL SECURITY READ TESTS PASSED');
  } finally {
    await env.cleanup();
  }
})().catch(err => {
  console.error('SECURITY TEST FAILED:', err);
  process.exitCode = 1;
});
