import test from 'node:test';
import assert from 'node:assert/strict';
import {templates,defaultDesign,renderEmail,safeLink} from '../src/templates.ts';
const company={company:'Example Company',address:'12 Example Road',color:'#24634b'};
test('every template renders a complete responsive email with its own layout and palette',()=>{
  assert.equal(templates.length,12);
  assert.equal(new Set(templates.map(t=>t.id)).size,12);
  assert.equal(new Set(templates.map(t=>t.layout)).size,6);
  for(const t of templates){
    const html=renderEmail({...t,preview:'Your latest update',design:{...defaultDesign(t),buttonUrl:'https://example.com/details'}},company);
    assert.match(html,/width=device-width/);
    assert.match(html,/@media screen and \(max-width:600px\)/);
    assert.ok(html.includes(t.accent));
    assert.ok(html.includes(t.background));
    assert.ok(html.includes('https://example.com/details'));
    assert.ok(!html.includes('{{name}}'));
    assert.ok(!html.includes('{{company}}'));
    assert.ok(html.includes('Your latest update'));
    assert.ok(html.includes('12 Example Road'));
  }
});
test('saved design survives JSON storage and retains edits in the exported HTML',()=>{
  const campaign={...templates[2],design:{...defaultDesign(templates[2]),title:'Our new chapter',accent:'#f7dd32',buttonLabel:'See the news',buttonUrl:'https://example.com/news'}};
  const restored=JSON.parse(JSON.stringify(campaign));
  const html=renderEmail(restored,company);
  assert.ok(html.includes('Our new chapter'));
  assert.ok(html.includes('#f7dd32'));
  assert.ok(html.includes('See the news'));
  assert.ok(html.includes('color:#14231f'));
});
test('existing drafts without a design still render their content',()=>{
  const html=renderEmail({body:'Hello {{name}},\n\nA legacy message.',subject:'A note'},company);
  assert.ok(html.includes('Hello Alex,'));
  assert.ok(html.includes('A legacy message.'));
});
test('editable content is escaped and unsafe link or color values never become active markup',()=>{
  const design={...defaultDesign(templates[0]),title:'<img src=x onerror=alert(1)>',kicker:'<script>alert(1)</script>',buttonLabel:'<b>Open</b>',buttonUrl:'javascript:alert(1)',accent:'red; background:url(https://attacker.invalid)'};
  const html=renderEmail({body:'<script>alert(1)</script>',design},{...company,company:'<svg onload=alert(1)>',address:'<img src=x>'});
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<svg'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(!html.includes('attacker.invalid'));
  assert.ok(html.includes('&lt;script&gt;'));
  for(const link of ['data:text/html,test','file:///etc/passwd','javascript:alert(1)','https://user:pass@example.com'])assert.equal(safeLink(link),'');
  assert.equal(safeLink('https://example.com'),'https://example.com/');
  assert.ok(!renderEmail({body:'Hello',design:defaultDesign(templates[0])},company).includes('<a href='));
});
