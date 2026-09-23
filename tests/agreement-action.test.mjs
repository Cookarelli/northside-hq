import {test} from 'node:test';
import assert from 'node:assert/strict';
import {agreementNameError,agreementActionError} from '../lib/agreement-action.ts';

test('signature name matches the staff record using the database case/outer-space rules',()=>{
  assert.equal(agreementNameError(' Kino ','Kino'),'');
  assert.equal(agreementNameError('KINO','Kino'),'');
  assert.match(agreementNameError('Different Name','Kino'),/exactly as shown: Kino/);
  assert.match(agreementNameError('','Kino'),/contact Steven before signing/);
});

test('real PostgREST-shaped name errors explain the failure instead of using the generic message',()=>{
  const error={code:'22023',details:null,hint:null,message:'Type your full name exactly as shown.'};
  assert.equal(error instanceof Error,false);
  assert.deepEqual(agreementActionError(error),{status:400,error:'Type your name exactly as shown above. If the displayed name is incorrect, contact Steven before signing.'});
});

test('known agreement and session failures give actionable, safe responses',()=>{
  assert.equal(agreementActionError(new Error('Unauthorized')).status,401);
  assert.equal(agreementActionError(new Error('Forbidden')).status,403);
  for(const error of [{code:'22023',message:'Agreement must be provided before acceptance.'},{code:'P0002',message:'Agreement unavailable.'}]) {
    assert.equal(agreementActionError(error).status,409);
    assert.match(agreementActionError(error).error,/Refresh the page/);
  }
  assert.equal(agreementActionError({code:'55000',message:'Agreement version changed. Contact your administrator.'}).status,409);
});

test('unexpected database and network errors never leak details or imply a saved signature',()=>{
  for(const error of [{code:'22023',message:'private database full name detail'},new Error('secret connection detail'),null,{message:'Type your full name exactly as shown.'}]) {
    const result=agreementActionError(error);
    assert.equal(result.status,503);
    assert.match(result.error,/Access remains locked/);
    assert.doesNotMatch(result.error,/private|secret/);
  }
});
