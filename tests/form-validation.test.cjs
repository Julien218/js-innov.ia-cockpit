const test = require('node:test');
const assert = require('node:assert/strict');
test('required fields include selects and whitespace while accepting numeric zero', async () => {
  const { missingRequiredField, numericInput } = await import('../src/lib/formValidation.js');
  const fields = [{name:'client',label:'Client',type:'select',required:true},{name:'amount',required:true}];
  assert.equal(missingRequiredField(fields,{client:' ',amount:0}),fields[0]);
  assert.equal(missingRequiredField(fields,{client:'id',amount:0}),undefined);
  assert.equal(numericInput('0'),0);
  assert.equal(numericInput('12.5'),12.5);
  assert.equal(numericInput(''), '');
  assert.equal(numericInput('oops'), '');
});
