import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blankDeliverable,blankProject} from '../lib/hq-model.ts';
import {workStatus,campaignStatus} from '../lib/hq-presentation.ts';

const project={...blankProject,status:'active',owner:'owner',brief:'Confirmed brief',version:1,budget:null};
const task={...blankDeliverable,owner:'maker',approver:'owner',instructions:'Prepare files',productionDue:'2026-09-23T12:00',publishing:false,requiresFinalFile:false,requiresCaption:false,platforms:[],status:'in_progress',publications:{},approval:null,contentVersion:1};
test('display statuses preserve blocked, review, approval and completion distinctions without mutating records',()=>{
 const before=structuredClone(task);
 assert.equal(workStatus({...task,status:'to_do'}),'not_started');
 assert.equal(workStatus({...task,status:'needs_review'}),'in_review');
 assert.equal(workStatus({...task,blocked:true}),'blocked');
 assert.equal(workStatus({...task,status:'ready'}),'attention','Ready with stale approval must not look on track');
 assert.equal(workStatus(task),'on_track');
 assert.equal(workStatus({...task,owner:''}),'attention');
 assert.equal(workStatus({...task,status:'done'}),'complete');
 assert.equal(workStatus({...task,publishing:true,publications:{facebook:{status:'published'},instagram:{status:'planned'}}}),'attention','Partly published is not complete');
 assert.equal(workStatus({...task,publishing:true,publications:{facebook:{status:'published'}}}),'complete');
 assert.deepEqual(task,before);
});
test('campaign labels reflect saved state and required inputs',()=>{
 assert.equal(campaignStatus(project),'on_track');
 assert.equal(campaignStatus({...project,status:'draft'}),'not_started');
 assert.equal(campaignStatus({...project,status:'completed'}),'complete');
 assert.equal(campaignStatus({...project,owner:''}),'attention');
});
