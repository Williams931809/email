import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Check,Eye,Mail,Monitor,Search,Smartphone,X} from 'lucide-react';
import {defaultDesign,renderEmail,safeColor,safeLink,templates} from './templates';
import type {EmailDesign,EmailTemplate} from './templates';

type Identity={company:string;address:string;color:string};
export function EmailPreview({html,title='Email preview'}:{html:string;title?:string}) {
  const [device,setDevice]=useState<'desktop'|'mobile'>('desktop');
  return <section className="email-preview-surface" aria-label={title}>
    <div className="preview-toolbar"><span><Mail size={15}/> Live preview</span><div role="group" aria-label="Preview size">
      <button type="button" aria-label="Desktop preview" aria-pressed={device==='desktop'} onClick={()=>setDevice('desktop')}><Monitor size={16}/></button>
      <button type="button" aria-label="Mobile preview" aria-pressed={device==='mobile'} onClick={()=>setDevice('mobile')}><Smartphone size={16}/></button>
    </div></div>
    <div className={'email-preview-stage '+device}><iframe title={title} sandbox="" srcDoc={html}/></div>
    <p className="preview-caption">Sample recipient: Alex · Colors and layout are included in HTML export.</p>
  </section>;
}

export function DesignEditor({value,onChange}:{value:EmailDesign;onChange:(next:EmailDesign)=>void}) {
  const change=(key:keyof EmailDesign,next:string)=>onChange({...value,[key]:next});
  const preset=templates.find(t=>t.id===value.templateId) || templates[0];
  const invalidLink=Boolean(value.buttonUrl.trim() && !safeLink(value.buttonUrl));
  return <fieldset className="design-editor"><legend>Email design</legend>
    <p>Make the layout yours. Changing a design keeps your message and subject.</p>
    <div className="two-col"><label>Layout & palette<select value={preset.id} onChange={e=>{
      const next=templates.find(t=>t.id===e.target.value)!;
      onChange({...value,templateId:next.id,accent:next.accent});
    }}>{templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    <label>Accent color<div className="accent-control"><input type="color" aria-label="Email accent color" value={safeColor(value.accent,preset.accent)} onChange={e=>change('accent',e.target.value)}/><span>{safeColor(value.accent,preset.accent).toUpperCase()}</span><button type="button" className="text-button" onClick={()=>change('accent',preset.accent)}>Reset</button></div></label></div>
    <label>Small heading<input maxLength={120} value={value.kicker} onChange={e=>change('kicker',e.target.value)}/></label>
    <label>Main headline<input maxLength={180} value={value.title} onChange={e=>change('title',e.target.value)}/></label>
    <div className="two-col"><label>Button label<input maxLength={80} value={value.buttonLabel} onChange={e=>change('buttonLabel',e.target.value)}/></label>
    <label>Button destination<input type="url" placeholder="https://your-website.com/page" value={value.buttonUrl} aria-invalid={invalidLink} aria-describedby="button-link-help" onChange={e=>change('buttonUrl',e.target.value)}/></label></div>
    <p id="button-link-help" className={invalidLink?'design-link-error':'design-help'}>{invalidLink?'Enter a full http:// or https:// web address. The button is hidden until the address is valid.':'Add a web address to show the button. Leave it empty for an email without a button.'}</p>
  </fieldset>;
}

export function TemplateGallery({identity,onUse}:{identity:Identity;onUse:(template:EmailTemplate)=>void}) {
  const [category,setCategory]=useState('All templates');
  const [query,setQuery]=useState('');
  const [selected,setSelected]=useState<EmailTemplate|null>(null);
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{if(selected)heading.current?.focus()},[selected]);
  const categories=['All templates',...new Set(templates.map(t=>t.tag))];
  const results=templates.filter(t=>(category==='All templates'||t.tag===category) && `${t.name} ${t.tag} ${t.description}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    <div className="page-heading"><div><div className="eyebrow">GOOD DESIGN. BETTER CONVERSATIONS.</div><h1>A beautiful place to start.</h1><p>Thoughtfully designed emails, ready for your company’s voice.</p></div><span className="template-count">12 curated designs</span></div>
    <section className="template-intro"><div><span className="template-intro-label">THE MAILROOM COLLECTION</span><h2>Make the right impression.<br/>Every time you press send.</h2><p>Rich color. Clear typography. Space for your story.<br/>Pick a starting point and make it unmistakably yours.</p></div><div className="collection-swatches" aria-hidden="true">{['#24634b','#234cc1','#6a37a5','#a73f25','#08666a','#8a6826'].map((c,i)=><span key={c} style={{background:c,transform:`rotate(${(i-2)*8}deg)`}}/>)}</div><div className="collection-features"><span><Check size={14}/>Responsive layouts</span><span><Check size={14}/>Editable colors & content</span><span><Check size={14}/>HTML preview export</span></div></section>
    {selected && <section className="template-detail card"><div className="template-detail-heading"><div><span className="eyebrow">{selected.tag}</span><h2 ref={heading} tabIndex={-1}>{selected.name}</h2><p>{selected.description}</p></div><button className="icon-button" aria-label="Close template preview" onClick={()=>setSelected(null)}><X size={20}/></button></div><EmailPreview html={renderEmail({...selected,design:{...defaultDesign(selected),buttonUrl:'https://example.com'}},identity)} title={selected.name+' full preview'}/><p className="template-sample-note">Sample text and button destination. Add your own website address in the campaign editor.</p><button className="primary" onClick={()=>onUse(selected)}>Use this template <ArrowRight size={16}/></button></section>}
    <div className="template-tools"><div className="template-filters" role="group" aria-label="Filter templates">{categories.map(c=><button key={c} aria-pressed={category===c} onClick={()=>setCategory(c)}>{c}</button>)}</div><label className="search template-search"><Search size={16}/><input aria-label="Search templates" placeholder="Find your style…" value={query} onChange={e=>setQuery(e.target.value)}/></label></div>
    <p className="template-results" aria-live="polite">{results.length} {results.length===1?'template':'templates'}{category!=='All templates'?` · ${category}`:''}</p>
    <div className="template-grid designed-templates">{results.map(t=><article className="designed-template" key={t.id}>
      <div className="designed-thumbnail" style={{background:t.background}}><iframe loading="lazy" tabIndex={-1} aria-hidden="true" title={t.name+' thumbnail'} sandbox="" srcDoc={renderEmail({...t,design:{...defaultDesign(t),buttonUrl:'https://example.com'}},identity)}/><span className="template-layout-label">{t.tag}</span></div>
      <div className="designed-template-info"><div className="template-meta"><span>{t.layout==='executive'?'SIGNATURE':t.layout==='editorial'?'EDITORIAL':'ESSENTIAL'}</span><div className="palette-dots" aria-label="Template palette"><i style={{background:t.accent}}/><i style={{background:t.ink}}/><i style={{background:t.background}}/></div></div><h3>{t.name}</h3><p>{t.description}</p><div className="template-card-actions"><button className="secondary" onClick={()=>setSelected(t)} aria-label={'Preview '+t.name}><Eye size={15}/>Preview</button><button className="primary" onClick={()=>onUse(t)} aria-label={'Use '+t.name}>Use template <ArrowRight size={14}/></button></div></div>
    </article>)}</div>
    {!results.length && <div className="empty-state card"><Search/><h3>No templates found.</h3><p>Try a different category or search term.</p><button className="secondary" onClick={()=>{setQuery('');setCategory('All templates')}}>Show all templates</button></div>}
  </>;
}
