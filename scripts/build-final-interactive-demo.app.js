
const CONTENT = __CONTENT_JSON__;
const MOCK = __MOCK_JSON__;
const PRICING = __PRICING_JSON__;
const MEMBERSHIP_CATALOGUE = __MEMBERSHIP_CATALOGUE_JSON__;
const ANNUAL_VALUE_FRAMING = __ANNUAL_VALUE_FRAMING_JSON__;
const COMPARISON_DATA = __COMPARISON_JSON__;
const JOURNEY_DATA = __JOURNEY_JSON__;
const AGENTS_DATA = __AGENTS_JSON__;
const NUM_LOCALE = { az: 'az-AZ', ru: 'ru-RU', en: 'en-US' };
const SCREEN_ORDER = ['landing','wizard','proposal','approvals','founder','tripRoom','payment','crm'];
let LOCALE = 'az';
let PERIOD = 'monthly';

function t(){ return CONTENT[LOCALE]; }
function m(){ return MOCK[LOCALE]; }

function fmtPrice(n){ return n === null ? null : n.toLocaleString(NUM_LOCALE[LOCALE]); }

function toast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(window.__toastT);
  window.__toastT = setTimeout(()=>el.classList.remove('show'), 2200);
}

/* ---------------- GLOBAL CHROME ----------------
   Header, mobile menu, demo banner and screen tabs are locale-driven and
   re-rendered on every load, every language change, and every screen
   change, so they can never lag behind the selected language. */
function renderGlobalChrome(){
  const M = m();
  document.getElementById('demo-badge').textContent = M.demoBadge;
  document.getElementById('demo-text').textContent = M.demoText;

  document.getElementById('nav-home').textContent = t().nav.home;
  document.getElementById('nav-wizard-lbl').textContent = t().nav.wizard;
  document.getElementById('nav-screens-lbl').textContent = t().nav.screens;
  document.getElementById('nav-login').textContent = t().nav.login;
  document.getElementById('menu-toggle').setAttribute('aria-label', M.menuAria);
  document.getElementById('screen-tabs-nav').setAttribute('aria-label', M.screensAria);

  document.getElementById('mnav-home').textContent = t().nav.home;
  document.getElementById('mnav-wizard').textContent = t().nav.wizard;
  document.getElementById('mnav-screens').textContent = t().nav.screens;
  document.getElementById('mnav-login').textContent = t().nav.login;

  SCREEN_ORDER.forEach(function(key){
    const el = document.getElementById('tab-' + key);
    if (el) el.textContent = M.tabs[key];
  });

  document.title = t().meta.title;
}

/* ---------------- LANDING ---------------- */
function renderLanding(){
  const d = t().landing;
  const journey = d.journeySteps;
  const authFlow = d.authorityFlow;

  document.getElementById('hero-eyebrow').textContent = d.eyebrow;
  document.getElementById('hero-title').textContent = d.title;
  document.getElementById('hero-lead').textContent = d.lead;
  document.getElementById('hero-primary').textContent = d.primaryAction;
  document.getElementById('hero-secondary').textContent = d.secondaryAction;

  document.getElementById('cta-clarity').innerHTML = d.ctaSteps.map((s,i)=>
    `<li><span class="cc-i">${i+1}</span>${s}</li>`).join('');

  const plansFrom = 19;
  document.getElementById('statline').innerHTML =
    `<span class="statline-chip">${d.statPlansFrom.replace('{price}', plansFrom.toLocaleString(NUM_LOCALE[LOCALE]))}</span>` +
    `<i aria-hidden="true">\u2726</i>` +
    `<span class="statline-chip statline-chip-trust">${d.statApproval}</span>`;

  document.getElementById('hp-toplabel').textContent = d.authorityFlowTitle;
  document.getElementById('hp-row1-l').textContent = journey[1];
  document.getElementById('hp-row1-r').textContent = authFlow[0];
  document.getElementById('hp-row2-l').textContent = journey[5];
  document.getElementById('hp-row2-r').textContent = authFlow[1];
  document.getElementById('hp-row3-l').textContent = journey[9];

  document.getElementById('scope-title').textContent = d.scopeTitle;
  document.getElementById('scope-lead').textContent = d.scopeLead;
  document.getElementById('scope-grid').innerHTML = d.scopeItems.map(x=>`<li>${x}</li>`).join('');

  document.getElementById('journey-eyebrow').textContent = d.journeyEyebrow;
  document.getElementById('journey-title').textContent = d.journeyTitle;
  document.getElementById('storyrail').innerHTML = journey.map((node,i)=>{
    const tone = (i===4||i===7||i===8) ? 'gold' : (i===3 ? 'em' : '');
    const arrow = i < journey.length-1 ? '<span class="sarr">\u2192</span>' : '';
    return `<span class="storyrail-item"><span class="snode ${tone}">${node}</span>${arrow}</span>`;
  }).join('');

  document.getElementById('why-title').textContent = d.whyTitle;
  document.getElementById('why-grid').innerHTML = d.why.map((pair,i)=>
    `<article class="why-card"><span class="why-card-index">${String(i+1).padStart(2,'0')}</span><h3>${pair[0]}</h3><p>${pair[1]}</p></article>`
  ).join('');

  document.getElementById('showcase-title').textContent = d.screensTitle;
  document.getElementById('showcase-lead').textContent = d.screensLead;
  document.getElementById('showcase-grid').innerHTML = SCREEN_ORDER.map(k=>{
    const s = t().screens[k];
    return `<div class="showcase-card" onclick="goScreen('${k}')"><span class="n">${s.number}</span><h4>${s.title}</h4><p>${s.description}</p></div>`;
  }).join('');

  document.getElementById('authority-title').textContent = d.authorityFlowTitle;
  document.getElementById('authority-body').textContent = d.authorityBody;
  document.getElementById('authflow').innerHTML = authFlow.map((step,i)=>{
    const cls = i===0 ? 'ai' : (i===1||i===3||i===5) ? 'human' : '';
    const arrow = i < authFlow.length-1 ? '<span class="sarr">\u2192</span>' : '';
    return `<span class="authstep"><span class="authbox ${cls}">${step}</span>${arrow}</span>`;
  }).join('');
  document.getElementById('receipt-badge').textContent = d.receiptExampleLabel;
  document.getElementById('receipt-line').textContent = d.receiptExampleLine;

  document.getElementById('personal-title').textContent = d.personalTitle;
  renderPlans();
  document.getElementById('price-note').textContent = d.priceNote;

  document.getElementById('corporate-title').textContent = d.corporateTitle;
  document.getElementById('corporate-body').textContent = d.corporateBody;
  document.getElementById('corp-bullets').innerHTML = d.corporateBullets.map(b=>`<li>${b}</li>`).join('');
  renderCorpPlans();
  renderComparisonTables();
  renderMemberValueJourney();
  renderAiAgentSection();

  document.getElementById('founder-kicker').textContent = d.founderKicker;
  document.getElementById('founder-name').textContent = d.founderName;
  document.getElementById('founder-role').textContent = d.founderRole;
  document.getElementById('founder-bio').textContent = d.founderBio;

  document.getElementById('final-title').textContent = d.finalTitle;
  document.getElementById('final-start').textContent = d.finalStart;
  document.getElementById('final-explore').textContent = d.finalExplore;
  document.getElementById('final-trust').innerHTML = `<i>\u2726</i> ${d.statApproval}`;

  document.getElementById('footer-tagline').textContent = d.footerTagline;
  document.getElementById('footer-privacy').textContent = t().footerLinks.privacy;
  document.getElementById('footer-terms').textContent = t().footerLinks.terms;
  document.getElementById('footer-contact').textContent = t().footerLinks.contact;
  document.getElementById('footer-support').textContent = t().footerLinks.support;

  document.getElementById('perctl-m').textContent = d.monthlyLabel || d.monthly;
  document.getElementById('perctl-a').textContent = d.annualLabel || d.annually;
}

function renderPlans(){
  const d = t().landing;
  const unit = PERIOD === 'monthly' ? d.monthly : d.annually;
  const catalogue = MEMBERSHIP_CATALOGUE[LOCALE].filter(p => p.category === 'PERSONAL');
  document.getElementById('plans-v2').innerHTML = catalogue.map(p=>{
    const price = PERIOD === 'monthly' ? p.pricing.monthly : p.pricing.annual;
    const hotTag = p.slug === 'premium' ? `<span class="plan-tag">${d.recommended}</span>` : '';
    const cls = 'plan-v2' + (p.slug === 'premium' ? ' hot' : '') + (p.slug === 'black' ? ' black' : '');
    const inheritHtml = p.inheritanceLabel ? `<span class="plan-inherit">${p.inheritanceLabel}</span>` : '';
    const benefitsHtml = `<ul class="plan-benefits">${p.benefits.map(b => `<li>${b}</li>`).join('')}</ul>`;
    return `<article class="${cls}">${hotTag}
      <span class="plan-nm">${p.name}</span>
      <span class="plan-best-for">${p.bestFor}</span>
      <span class="plan-pr">${fmtPrice(price)} \u20bc<span>/${unit}</span></span>
      <span class="plan-ann">${fmtPrice(p.pricing.monthly)} \u20bc/${d.monthly} \u00b7 ${fmtPrice(p.pricing.annual)} \u20bc/${d.annually}</span>
      ${p.pricing.annualSaving ? `<span class="plan-annual-saving">${ANNUAL_VALUE_FRAMING[LOCALE]} \u2014 ${fmtPrice(p.pricing.annualSaving)} \u20bc</span>` : ''}
      ${inheritHtml}
      ${benefitsHtml}
      <button class="btn btn-gold btn-sm" onclick="goScreen('wizard')">${p.ctaLabel}</button>
    </article>`;
  }).join('');
}

function renderCorpPlans(){
  const d = t().landing;
  const catalogue = MEMBERSHIP_CATALOGUE[LOCALE].filter(p => p.category === 'CORPORATE');
  document.getElementById('corpgrid').innerHTML = catalogue.map(p=>{
    const priceHtml = p.pricing.isCustomPriced
      ? `<span class="plan-pr">${d.custom}</span>`
      : `<span class="plan-pr">${fmtPrice(p.pricing.monthly)} \u20bc<span>/${d.monthly}</span></span>`;
    const inheritHtml = p.inheritanceLabel ? `<span class="plan-inherit">${p.inheritanceLabel}</span>` : '';
    const benefitsHtml = `<ul class="plan-benefits">${p.benefits.map(b => `<li>${b}</li>`).join('')}</ul>`;
    return `<article class="plan-v2 corp2">
      <span class="plan-nm">${p.name}</span>
      <span class="plan-best-for">${p.bestFor}</span>
      ${priceHtml}
      ${inheritHtml}
      ${benefitsHtml}
      <button class="btn btn-em btn-sm" onclick="goScreen('wizard')">${p.ctaLabel}</button>
    </article>`;
  }).join('');
}

function renderComparisonTable(containerId, table){
  const rowsHtml = table.rows.map(row => `<tr data-row-key="${row.key}"><th scope="row">${row.label}</th>${
    row.cells.map(cell => `<td>${cell === true ? '\u2713' : cell === false ? '\u2014' : cell}</td>`).join('')
  }</tr>`).join('');
  const cardsHtml = table.planNames.map((name, planIdx) => {
    const rowsForCard = table.rows.map(row => {
      const cell = row.cells[planIdx];
      const display = cell === true ? '\u2713' : cell === false ? '\u2014' : cell;
      return `<div class="membership-comparison-card-row" data-row-key="${row.key}"><dt>${row.label}</dt><dd>${display}</dd></div>`;
    }).join('');
    return `<div class="membership-comparison-card"><h3>${name}</h3><dl>${rowsForCard}</dl></div>`;
  }).join('');
  document.getElementById(containerId).innerHTML = `
    <h2>${table.title}</h2>
    <div class="membership-comparison-scroll" role="region" aria-label="${table.title}" tabindex="0">
      <table class="membership-comparison-table">
        <thead><tr><th scope="col">${table.featureLabel}</th>${table.planNames.map(n=>`<th scope="col">${n}</th>`).join('')}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div class="membership-comparison-cards">${cardsHtml}</div>`;
}

function renderComparisonTables(){
  const data = COMPARISON_DATA[LOCALE];
  renderComparisonTable('personal-comparison', data.personal);
  renderComparisonTable('corporate-comparison', data.corporate);
}

function renderMemberValueJourney(){
  const data = JOURNEY_DATA[LOCALE];
  const stepsHtml = data.steps.map((step, i) => `
    <li class="mvj-step">
      <div class="mvj-step-header"><span class="mvj-step-number">${i+1}</span><h3>${step.title}</h3></div>
      <dl class="mvj-step-detail">
        <dt>${data.fieldLabels.provides}</dt><dd>${step.customerProvides}</dd>
        <dt>${data.fieldLabels.prepares}</dt><dd>${step.voyaraPrepares}</dd>
        <dt>${data.fieldLabels.value}</dt><dd>${step.commercialValue}</dd>
        <dt>${data.fieldLabels.approval}</dt><dd>${step.approvalPoint}</dd>
        <dt>${data.fieldLabels.next}</dt><dd>${step.nextStep}</dd>
      </dl>
    </li>`).join('');
  document.getElementById('member-value-journey').innerHTML = `
    <div class="section-heading">
      <span class="eyebrow">VOYARA AI</span>
      <h2 id="mvj-title">${data.title}</h2>
      <p>${data.intro}</p>
      <p class="mvj-principle">${data.operatingPrinciple}</p>
    </div>
    <ol class="mvj-steps">${stepsHtml}</ol>`;
}

function renderAiAgentSection(){
  const data = AGENTS_DATA[LOCALE];
  const cardsHtml = data.agents.map(agent => `
    <article class="ai-agent-card">
      <div class="ai-agent-card-header">
        <h3>${agent.name}</h3>
        <span class="ai-agent-status ai-agent-status-${agent.status.toLowerCase().replace(/_/g,'-')}">${agent.statusLabel}</span>
      </div>
      <p class="ai-agent-benefit">${agent.memberBenefit}</p>
      <dl class="ai-agent-detail-list">
        <dt>${data.fieldLabels.prepares}</dt><dd>${agent.prepares}</dd>
        <dt>${data.fieldLabels.automates}</dt><dd>${agent.safelyAutomates}</dd>
        <dt>${data.fieldLabels.approval}</dt><dd>${agent.requiresApproval}</dd>
        <dt>${data.fieldLabels.channel}</dt><dd>${agent.channel}</dd>
      </dl>
    </article>`).join('');
  document.getElementById('ai-agent-section').innerHTML = `
    <div class="section-heading">
      <span class="eyebrow">VOYARA AI</span>
      <h2 id="ai-agent-title">${data.title}</h2>
      <p>${data.intro}</p>
    </div>
    <div class="ai-agent-grid">${cardsHtml}</div>`;
}

function setPeriod(p){
  PERIOD = p;
  document.getElementById('perctl-m').classList.toggle('on', p==='monthly');
  document.getElementById('perctl-a').classList.toggle('on', p==='annually');
  renderPlans();
}

/* ---------------- MOCK SCREENS (2-8) ---------------- */
function renderMockHead(prefix, key){
  const s = t().screens[key];
  document.getElementById(prefix+'-n').textContent = s.number;
  document.getElementById(prefix+'-title').textContent = s.title;
  document.getElementById(prefix+'-desc').textContent = s.description;
  document.getElementById(prefix+'-pills').innerHTML = s.states.map((st,i)=>
    `<span class="state-pill${i===0?' active':''}">${st}</span>`).join('');
}

let wizStep = 1;
function renderWizard(){
  renderMockHead('wiz', 'wizard');
  const d = t().landing;
  const W = m().wiz;
  const G = m().geo;

  document.getElementById('wiz-step1-html').innerHTML = `
    <div class="mock-card">
      <h3>${G.maldives}</h3>
      <div class="field"><label>${W.startDate}</label><input type="date" value="2026-10-12"></div>
      <div class="field"><label>${W.nights}</label><input type="number" value="7"></div>
      <button class="btn btn-em" onclick="goWizStep(2)">${W.continue}</button>
    </div>`;

  document.getElementById('wiz-step2-html').innerHTML = `
    <div class="mock-card">
      <h3>${W.step2Title}</h3>
      <div class="field"><label>${W.travellers}</label>
        <div class="chip-row">
          <span class="chip sel" onclick="selectChip(this)">${W.chip1}</span>
          <span class="chip" onclick="selectChip(this)">${W.chip2}</span>
          <span class="chip" onclick="selectChip(this)">${W.chip3}</span>
        </div>
      </div>
      <div class="field"><label>${W.planLabel}</label>
        <div class="chip-row">
          <span class="chip" onclick="selectChip(this)">Smart</span>
          <span class="chip sel" onclick="selectChip(this)">Premium</span>
          <span class="chip" onclick="selectChip(this)">Black</span>
        </div>
      </div>
      <button class="btn btn-em" onclick="goWizStep(3)">${W.continue}</button>
    </div>`;

  document.getElementById('wiz-step3-html').innerHTML = `
    <div class="mock-card">
      <h3>${W.step3Title}</h3>
      <div class="mock-row"><b>${G.maldives}</b><span>7 ${m().unitNight} \u00b7 2 ${m().unitAdult}</span></div>
      <div class="mock-row"><b>${W.planLabel}</b><span>Premium</span></div>
      <button class="btn btn-gold" id="wiz-cta" onclick="submitWizard()">${d.primaryAction}</button>
    </div>`;

  goWizStep(1);
}
function goWizStep(n){
  wizStep = n;
  for(let i=1;i<=3;i++){
    document.getElementById('wiz-step-'+i).classList.toggle('on', i===n);
  }
  document.querySelectorAll('.wiz-dots span').forEach((el,i)=>el.classList.toggle('on', i < n));
}
function selectChip(el){
  el.parentElement.querySelectorAll('.chip').forEach(c=>c.classList.remove('sel'));
  el.classList.add('sel');
}
function submitWizard(){
  toast(m().wiz.submitToast);
  setTimeout(()=>goScreen('proposal'), 900);
}

function renderProposal(){
  renderMockHead('prop', 'proposal');
  const P = m().prop;
  const G = m().geo;
  document.getElementById('prop-card').innerHTML = `
    <div class="mock-card">
      <div class="mock-row"><b>${P.dest}</b><span>${G.maldives}</span></div>
      <div class="mock-row"><b>${P.nights}</b><span>7</span></div>
      <div class="mock-row"><b>${P.price}</b><span>${(2010).toLocaleString(NUM_LOCALE[LOCALE])} \u20bc</span></div>
      <div class="mock-row"><span class="mock-badge pending">${P.approve}</span><button class="btn btn-gold btn-sm" onclick="acceptProposal()">${P.accept}</button></div>
    </div>`;
}
function acceptProposal(){
  toast(m().prop.acceptToast);
  setTimeout(()=>goScreen('tripRoom'), 900);
}

function renderApprovals(){
  renderMockHead('appr', 'approvals');
  const A = m().appr;
  const G = m().geo;
  const items = [
    {name:'Soneva Jani \u00b7 Water Retreat', amt: (12010).toLocaleString(NUM_LOCALE[LOCALE]) + ' \u20bc', risk: A.risk1},
    {name: G.baku + ' \u2192 ' + G.male + ' \u00b7 QR054', amt: (640).toLocaleString(NUM_LOCALE[LOCALE]) + ' \u20bc', risk: A.risk2}
  ];
  document.getElementById('appr-list').innerHTML = items.map(it=>`
    <div class="mock-card">
      <div class="mock-row"><b>${it.name}</b><span class="mock-badge pending">${it.risk}</span></div>
      <div class="mock-row"><span>${it.amt}</span>
        <span><button class="btn btn-em btn-sm" onclick="decideApproval(this,true)">${A.approve}</button>
        <button class="btn btn-ghost btn-sm" onclick="decideApproval(this,false)">${A.reject}</button></span>
      </div>
    </div>`).join('');
}
function decideApproval(el, approved){
  const card = el.closest('.mock-card');
  const badge = card.querySelector('.mock-badge');
  const A = m().appr;
  if(approved){
    badge.textContent = A.approved;
    badge.className = 'mock-badge done';
  } else {
    badge.textContent = A.rejected;
    badge.className = 'mock-badge hold';
  }
  card.querySelectorAll('button').forEach(b=>b.disabled=true);
  toast(A.decisionToast);
}

function renderFounder(){
  renderMockHead('fdr', 'founder');
  const F = m().fdr;
  const kpis = [
    {v: '\u20bc' + (17430).toLocaleString(NUM_LOCALE[LOCALE]), l: F.mrr},
    {v: (250).toLocaleString(NUM_LOCALE[LOCALE]), l: F.subscribers},
    {v: (3).toLocaleString(NUM_LOCALE[LOCALE]), l: F.approvalsWaiting}
  ];
  document.getElementById('fdr-kpis').innerHTML = kpis.map(k=>`<div class="mock-kpi"><div class="v">${k.v}</div><div class="l">${k.l}</div></div>`).join('');
}

function renderTripRoom(){
  renderMockHead('trip', 'tripRoom');
  const T = m().trip;
  const rows = [
    {l: T.itinerary, v: T.confirmed, cls:'done'},
    {l: T.documents, v: T.uploaded, cls:'done'},
    {l: T.visa, v: T.inReview, cls:'pending'}
  ];
  document.getElementById('trip-card').innerHTML = `<div class="mock-card">` +
    rows.map(r=>`<div class="mock-row"><b>${r.l}</b><span class="mock-badge ${r.cls}">${r.v}</span></div>`).join('') +
    `</div>`;
}

function renderPayment(){
  renderMockHead('pay', 'payment');
  const P = m().pay;
  const priceStr = (2010).toLocaleString(NUM_LOCALE[LOCALE]) + ' \u20bc';
  const rows = [
    {l: P.request, v: priceStr},
    {l: P.financeReview, v: P.pending, badge:'pending'},
    {l: P.readiness, v: P.notReady, badge:'hold'}
  ];
  document.getElementById('pay-card').innerHTML = `<div class="mock-card">` +
    rows.map(r=>`<div class="mock-row"><b>${r.l}</b>${r.badge?`<span class="mock-badge ${r.badge}">${r.v}</span>`:`<span>${r.v}</span>`}</div>`).join('') +
    `<div class="mock-row"><button class="btn btn-gold btn-sm" onclick="approvePayment()">${P.approveBtn}</button></div>` +
    `</div>`;
}
function approvePayment(){
  const P = m().pay;
  toast(P.toast);
  renderPayment();
  setTimeout(()=>{
    const badge = document.querySelectorAll('#pay-card .mock-badge')[0];
    if (badge) { badge.textContent = P.confirmed; badge.className = 'mock-badge done'; }
  }, 100);
}

function renderCRM(){
  renderMockHead('crm', 'crm');
  const Cc = m().crm;
  const leads = [
    {n: Cc.lead1, src:'Instagram', v: Cc.new},
    {n: Cc.lead2, src:'WhatsApp', v: Cc.humanReview},
    {n: Cc.lead3, src: Cc.website, v: Cc.opTask}
  ];
  document.getElementById('crm-list').innerHTML = leads.map(l=>`
    <div class="mock-row"><b>${l.n}</b><span>${l.src}</span><span class="mock-badge pending">${l.v}</span></div>
  `).join('');
}

/* ---------------- NAVIGATION ---------------- */
const SCREEN_RENDERERS = {
  landing: renderLanding, wizard: renderWizard, proposal: renderProposal,
  approvals: renderApprovals, founder: renderFounder, tripRoom: renderTripRoom,
  payment: renderPayment, crm: renderCRM
};
function goScreen(key){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('on'));
  document.getElementById('screen-'+key).classList.add('on');
  document.querySelectorAll('.screen-tab').forEach(b=>b.classList.toggle('on', b.dataset.k===key));
  document.getElementById('mobile-nav').classList.remove('open');
  window.scrollTo({top:0, behavior:'instant'});
  renderGlobalChrome();
  SCREEN_RENDERERS[key]();
}
function setLocale(loc){
  LOCALE = loc;
  document.documentElement.lang = loc;
  document.querySelectorAll('.langsw button').forEach(b=>b.classList.toggle('on', b.dataset.l===loc));
  renderGlobalChrome();
  const active = document.querySelector('.screen.on');
  const key = active ? active.id.replace('screen-','') : 'landing';
  SCREEN_RENDERERS[key]();
}
function showSigninToast(){
  toast(m().signinToast);
}

document.addEventListener('DOMContentLoaded', function(){
  setLocale('az');
  goScreen('landing');
  document.getElementById('menu-toggle').addEventListener('click', function(){
    document.getElementById('mobile-nav').classList.toggle('open');
  });
});
