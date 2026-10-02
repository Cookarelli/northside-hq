import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import ts from 'typescript';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://hq.example.test',pretendToBeVisual:true});
for(const name of ['window','document','HTMLElement','HTMLButtonElement','Node','NodeFilter','Element','MutationObserver','CustomEvent','Event','KeyboardEvent'])globalThis[name]=dom.window[name];
globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('react');
const {render,screen,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');
const dataUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const cache=new Map();
async function compile(file){
 if(cache.has(file))return cache.get(file);
 let source=await readFile(new URL('../'+file,import.meta.url),'utf8');
 source=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const specs=[...source.matchAll(/from ["']([^"']+)["']/g)].map(m=>m[1]);
 for(const spec of specs){
  let resolved;
  if(spec==='next/link')resolved=dataUrl(`import {createElement} from ${JSON.stringify(import.meta.resolve('react'))};export default function Link(props){return createElement('a',props)}`);
  else if(spec.startsWith('@/')){const stem=spec.slice(2);resolved=await compile(stem+(stem.startsWith('components/')?'.tsx':'.ts'));}
  else if(spec.startsWith('.'))resolved=new URL('../'+file.slice(0,file.lastIndexOf('/')+1)+spec,import.meta.url).href;
  else resolved=import.meta.resolve(spec);
  source=source.replaceAll('"'+spec+'"',JSON.stringify(resolved)).replaceAll("'"+spec+"'",JSON.stringify(resolved));
 }
 const result=dataUrl(source);cache.set(file,result);return result;
}
const {HqDeleteAction}=await import(await compile('components/hq-delete-action.tsx'));
const record={id:'item',data:{title:'October auction preview',version:7,owner:'jon',createdBy:'steve',publications:{}}};
const defaults={kind:'deliverable',record,context:{staffId:'jon',admin:false},busy:false,onDelete:async()=>{},onReload:()=>{}};
function show(props={}){return render(React.createElement(HqDeleteAction,{...defaults,...props}));}
function open(kind='deliverable'){fireEvent.click(screen.getByRole('button',{name:'Delete '+kind}));return screen.getByRole('alertdialog');}
function confirm(kind='deliverable'){fireEvent.click(screen.getByRole('alertdialog').querySelector('[data-slot="alert-dialog-action"]'));}
afterEach(()=>cleanup());

test('confirmation names the item, focuses Cancel, and cancel/Escape send no deletion',async()=>{
 let calls=0;show({onDelete:async()=>{calls++;}});
 assert.equal(screen.queryByRole('alertdialog'),null);open();
 assert.ok(screen.getByRole('heading',{name:'Delete deliverable “October auction preview”?' }));
 assert.equal(document.activeElement,screen.getByRole('button',{name:'Cancel'}));
 fireEvent.click(screen.getByRole('button',{name:'Cancel'}));assert.equal(calls,0);
 await waitFor(()=>assert.equal(screen.queryByRole('alertdialog'),null));
 open();fireEvent.keyDown(document.activeElement,{key:'Escape',code:'Escape'});
 await waitFor(()=>assert.equal(screen.queryByRole('alertdialog'),null));assert.equal(calls,0);
});

test('project dialog counts all attached work and blocks confirmation with a usable deliverable link',()=>{
 let calls=0;show({kind:'project',attachedCount:3,onDelete:async()=>{calls++;}});open('project');
 assert.match(screen.getByRole('alertdialog').textContent,/3 attached deliverables.*individually.*another project/);
 assert.equal(screen.getByRole('alertdialog').querySelector('[data-slot="alert-dialog-action"]').disabled,true);
 assert.equal(screen.getByRole('link',{name:/Review attached/}).getAttribute('href'),'/projects/item?tab=deliverables');
 confirm('project');assert.equal(calls,0);
});

test('empty project can be deleted only after confirmation and duplicate clicks send one request',async()=>{
 let calls=0,finish;const promise=new Promise(resolve=>finish=resolve);
 show({kind:'project',attachedCount:0,onDelete:async(kind,target)=>{calls++;assert.equal(kind,'project');assert.equal(target.data.version,7);await promise;}});open('project');
 assert.match(screen.getByRole('alertdialog').textContent,/0 attached deliverables/);assert.equal(calls,0);
 confirm('project');confirm('project');assert.equal(calls,1);assert.ok(screen.getByRole('button',{name:'Deleting…'}).disabled);
 await act(async()=>finish());await waitFor(()=>assert.equal(screen.queryByRole('alertdialog'),null));
});

test('failed deletion stays open with actionable error and reload; the confirmed name/version stay frozen',async()=>{
 let target,reloaded=false;
 const props={onDelete:async(_,value)=>{target=value;throw new Error('This item changed. Reload saved records.');},onReload:()=>reloaded=true};
 const view=show(props);open();
 view.rerender(React.createElement(HqDeleteAction,{...defaults,...props,record:{...record,data:{...record.data,title:'New title',version:8}}}));
 assert.ok(screen.getByRole('heading',{name:'Delete deliverable “October auction preview”?' }));confirm();
 await waitFor(()=>assert.match(screen.getByRole('alert').textContent,/This item changed/));
 assert.equal(target.data.version,7);assert.equal(target.data.title,record.data.title);
 fireEvent.click(screen.getByRole('button',{name:'Reload saved records'}));assert.equal(reloaded,true);
 await waitFor(()=>assert.equal(screen.queryByRole('alertdialog'),null));
});

test('other staff see no Delete action; admins can delete; retained records do not offer it',()=>{
 const view=show({context:{staffId:'brody',admin:false}});assert.equal(screen.queryByRole('button'),null);
 view.rerender(React.createElement(HqDeleteAction,{...defaults,context:{staffId:'steve',admin:true}}));assert.ok(screen.getByRole('button',{name:'Delete deliverable'}));
 view.rerender(React.createElement(HqDeleteAction,{...defaults,record:{...record,data:{...record.data,deletedAt:'2026-10-02'}}}));assert.equal(screen.queryByRole('button'),null);
});
