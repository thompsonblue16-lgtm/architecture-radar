(function () {
  'use strict';
  let payload = window.ARCH_RADAR_DATA || {articles: [],updated_at: null,feed_count: 0};
  let articles = cleanArticles(payload.articles);
  let archivedFavorites = [];
  const configured = Boolean(window.ARCH_RADAR_SUPABASE?.url && window.ARCH_RADAR_SUPABASE?.anonKey);
  const categories = ['全部', '设计发布', '审批落地', '开工建设', '项目竣工', '竞赛招标', '行业动态'];
  const stages = categories.slice(1);
  const $ = id => document.getElementById(id);
  const state = { view: 'overview', category: '全部', region: 'all', search: '', sort: 'newest', limit: 12 };
  const publishers = [
    ['ArchDaily','https://www.archdaily.com/','建筑项目'],
    ['Dezeen','https://www.dezeen.com/architecture/','国际设计'],
    ["The Architect’s Newspaper",'https://www.archpaper.com/','北美建筑'],
    ['designboom','https://www.designboom.com/architecture/','设计与创新'],
    ['Architectural Record','https://www.architecturalrecord.com/','建筑专业'],
    ['Engineering News-Record','https://www.enr.com/','工程建设'],
    ['Construction Dive','https://www.constructiondive.com/','项目施工'],
    ['Building Design+Construction','https://www.bdcnetwork.com/','AEC 行业'],
    ['Archinect','https://archinect.com/news','设计动态'],
    ['World Architecture Community','https://worldarchitecture.org/','全球项目'],
    ['Urbanize Chicago','https://chicago.urbanize.city/','芝加哥开发'],
    ['CTBUH','https://www.ctbuh.org/','高层建筑'],
    ['Metropolis','https://metropolismag.com/','城市与设计'],
    ['AIA','https://www.aia.org/','美国建筑师'],
    ['Iowa Capital Dispatch','https://iowacapitaldispatch.com/','爱荷华动态'],
    ['University of Iowa','https://now.uiowa.edu/','校园项目']
  ];
  let saved = new Set();
  if (!configured) { try { saved = new Set(JSON.parse(localStorage.getItem('ar-favorites-v1') || '[]')); } catch (_) {} }
  function cleanArticles(raw) {return Array.isArray(raw) ? raw.filter(x => x && x.title && x.url && x.published && x.id) : [];}
  const safe = text => String(text ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function webUrl(url) {try {const u=new URL(url);return ['https:','http:'].includes(u.protocol)?u.href:'#';}catch{return '#';}}
  function date(value,opts={month:'short',day:'numeric',year:'numeric'}) {try{return new Intl.DateTimeFormat('zh-CN',{...opts,timeZone:'America/Chicago'}).format(new Date(value));}catch{return '—';}}
  function daysAgo(d){return (Date.now()-Date.parse(d))/86400000;}
  function updatedTime(value){return value?date(value,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'尚未采集';}
  function stageCount(stage){return articles.filter(a=>a.category===stage).length;}
  function countBy(key){const c=new Map();articles.forEach(a=>c.set(a[key]||'其他',(c.get(a[key]||'其他')||0)+1));return [...c].sort((a,b)=>b[1]-a[1]);}
  function sourceCount(){return new Set(articles.map(a=>a.source).filter(Boolean)).size;}
  function showNotice(message,type='info'){
    const el=$('sync-feedback');el.textContent=message;el.dataset.type=type;el.hidden=false;
  }
  function updateSummary(){
    $('today-label').textContent=date(new Date().toISOString(),{month:'long',day:'numeric',weekday:'short'});
    $('stat-total').textContent=articles.length.toLocaleString('en-US');
    $('stat-week').textContent=articles.filter(a=>daysAgo(a.published)>=0&&daysAgo(a.published)<=7).length;
    $('stat-progress').textContent=articles.filter(a=>['审批落地','开工建设','项目竣工'].includes(a.category)).length;
    $('stat-updated').textContent=updatedTime(payload.updated_at);
    const hasLiveData=Number(payload.feed_count)>0;
    $('stat-status').textContent=hasLiveData?`${payload.feed_count} / ${payload.feed_attempted||'?'} 路订阅成功 · ${sourceCount()} 家媒体`:'初始精选数据 · 尚未成功在线采集';
    $('sync-indicator').innerHTML=`<i></i> ${hasLiveData?'新闻数据已发布':'初始数据'}`;
    $('saved-count').textContent=saved.size;
  }
  function barRows(data,allCount,clickType){
    if(!data.length)return '<p class="dash-placeholder">暂无内容，采集后自动显示。</p>';
    return data.map(([name,n])=>`<button type="button" class="breakdown-row" ${clickType?`data-overview-filter="${safe(clickType)}" data-filter-value="${safe(name)}"`:''}>
      <span class="breakdown-label">${safe(name)}</span><span class="breakdown-bar"><i style="width:${allCount?Math.max(2,(n/allCount)*100):0}%"></i></span><strong>${n}</strong>
    </button>`).join('');
  }
  function renderOverview(){
    const recents=articles.filter(a=>daysAgo(a.published)>=0&&daysAgo(a.published)<=7);
    const regions=countBy('region');
    const sectors=countBy('sector');
    const last=articles.slice().sort((a,b)=>Date.parse(b.published)-Date.parse(a.published));
    const lead=last[0];
    const hasLiveData=Number(payload.feed_count)>0;
    $('briefing-strip').innerHTML=`
      <div><span>本期收录</span><strong>${articles.length}</strong><small>条公开项目动态</small></div>
      <div><span>最近 7 天</span><strong>${recents.length}</strong><small>条近期消息</small></div>
      <div><span>媒体来源</span><strong>${sourceCount()}</strong><small>家实际收录媒体</small></div>
      <div><span>最新采集</span><strong class="date-metric">${safe(updatedTime(payload.updated_at))}</strong><small>${hasLiveData?'完成过在线采集':'仅初始精选内容'}</small></div>`;
    $('overview-top-news').innerHTML=last.length?last.slice(0,7).map((a,i)=>`<a href="${safe(webUrl(a.url))}" target="_blank" rel="noopener noreferrer" class="overview-headline"><span class="headline-rank">${String(i+1).padStart(2,'0')}</span><span class="headline-main"><strong>${safe(a.title)}</strong><small>${safe(a.source)} · ${safe(a.category)} · ${safe(date(a.published))}</small></span><span class="headline-arrow">↗</span></a>`).join(''):'<p class="dash-placeholder">暂无新闻</p>';
    $('overview-stages').innerHTML=barRows(stages.map(x=>[x,stageCount(x)]),articles.length,'category');
    $('overview-regions').innerHTML=barRows(regions,articles.length,'region');
    $('overview-sectors').innerHTML=barRows(sectors.slice(0,7),articles.length,'sector');
    const sourceRows=countBy('source');
    $('overview-sources').innerHTML=`<div class="source-totals"><strong>${sourceCount()}</strong><div>实际有收录的媒体<small>成功读取 ${Number(payload.feed_count)||0} / ${Number(payload.feed_attempted)||'—'} 路订阅</small></div></div>${sourceRows.slice(0,6).map(([name,n])=>`<div class="source-mini"><span>${safe(name)}</span><strong>${n}</strong></div>`).join('')}${!hasLiveData?'<p class="dash-caution">现有数据是初始精选；部署后运行采集任务才能增加实时内容。</p>':''}`;
    const now=new Date();const bars=[];
    for(let i=13;i>=0;i--){
      const d=new Date(now.getTime()-i*86400000);
      const key=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
      const n=articles.filter(a=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(a.published))===key).length;
      bars.push({key,n});
    }
    const max=Math.max(...bars.map(b=>b.n),1);
    $('overview-trend').innerHTML=`<div class="trend-bars">${bars.map((b,i)=>`<div class="trend-column" title="${safe(b.key)}：${b.n} 条"><span>${b.n||''}</span><i style="height:${Math.max(5,(b.n/max)*100)}%"></i></div>`).join('')}</div><div class="trend-axis"><span>14 天前</span><span>今天</span></div>`;
    const counts=new Map(sourceRows);
    const countFor=name=>{
      const needle=name.toLowerCase().replace(/[^a-z]/g,'');
      return sourceRows.filter(([x])=>x.toLowerCase().replace(/[^a-z]/g,'').includes(needle)||needle.includes(x.toLowerCase().replace(/[^a-z]/g,''))).reduce((sum,[,n])=>sum+n,0);
    };
    $('source-directory').innerHTML=publishers.map(([name,url,desc])=>`<a class="source-card" href="${safe(url)}" target="_blank" rel="noopener noreferrer"><span class="source-card-type">${safe(desc)}</span><strong>${safe(name)}</strong><span class="source-card-footer">${countFor(name)} 条已收录 <span>↗</span></span></a>`).join('');
  }
  function renderFilters(){
    $('nav-status').innerHTML=stages.map(stage=>`<button type="button" class="status-link ${state.category===stage&&state.view==='all'?'active':''}" data-category="${safe(stage)}"><span class="status-marker"></span><span>${safe(stage)}</span><span class="status-count">${stageCount(stage)}</span></button>`).join('');
    $('category-filters').innerHTML=categories.map(stage=>`<button type="button" data-category="${safe(stage)}" class="category-pill ${state.category===stage?'selected':''}" aria-pressed="${state.category===stage}">${safe(stage)}</button>`).join('');
    document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===state.view&&el.classList.contains('nav-link')));
  }
  function listed(){
    const q=state.search.trim().toLowerCase();
    const all=state.view==='saved'?[...articles,...archivedFavorites.filter(a=>!articles.some(b=>a.id===b.id))]:articles;
    return all.filter(a=>{
      if(state.view==='recent'&&daysAgo(a.published)>7)return false;
      if(state.view==='saved'&&!saved.has(a.id))return false;
      if(state.category!=='全部'&&state.category!==a.category)return false;
      if(state.region!=='all'&&state.region!==a.region)return false;
      if(state.sector&&state.sector!==a.sector)return false;
      if(q&&![a.title,a.summary,a.source,a.region,a.sector,a.category].some(v=>(v||'').toLowerCase().includes(q)))return false;
      return true;
    }).sort((a,b)=>(Date.parse(b.published)-Date.parse(a.published))*(state.sort==='oldest'?-1:1));
  }
  function cover(a){
    const v='<div class="cover-visual"><svg viewBox="0 0 320 160" aria-hidden="true"><path d="M34 141V44L96 10L168 54V141M96 10V141M34 44L96 77L168 54M168 141V30L244 61V141M244 61L286 42V141M34 141H286M56 60V130M74 68V130M114 70V130M136 62V130M185 55V130M207 63V130M226 70V130M264 54V130"/><path d="M14 151H306M23 158H286" stroke-dasharray="4 6"/></svg><span>ARCHITECTURE / FIELD NOTES</span></div>';
    const image=a.image&&webUrl(a.image).startsWith('https:')?`<img src="${safe(webUrl(a.image))}" loading="lazy" alt="来源媒体提供的项目配图" referrerpolicy="no-referrer" />`:'';
    return `<div class="card-cover cover--${safe(a.sector||'综合项目')}">${v}${image}<span class="card-stage">${safe(a.category)}</span><button class="card-save ${saved.has(a.id)?'saved':''}" type="button" data-save="${safe(a.id)}" aria-label="${saved.has(a.id)?'取消收藏':'收藏文章'}" title="${saved.has(a.id)?'取消收藏':'收藏文章'}">${saved.has(a.id)?'♥':'♡'}</button></div>`;
  }
  function card(a){
    return `<article class="news-card">${cover(a)}<div class="card-body"><div class="card-meta"><span class="source-name">${safe(a.source||'SOURCE')}</span><span class="meta-dot">·</span><time datetime="${safe(a.published)}">${safe(date(a.published))}</time></div><h3><a href="${safe(webUrl(a.url))}" target="_blank" rel="noopener noreferrer">${safe(a.title)}</a></h3><p class="card-desc">${safe(a.summary||'点击前往原始新闻来源，查看项目详情、设计图与完整报道。')}</p><div class="card-bottom"><span class="card-area">⌁ ${safe(a.region||'其他地区')} · ${safe(a.sector||'综合项目')}</span><a class="card-read" href="${safe(webUrl(a.url))}" target="_blank" rel="noopener noreferrer">阅读原文 ↗</a></div><button type="button" class="card-track" data-track="${safe(a.id)}">+ 添加到共享项目</button></div></article>`;
  }
  function render(){
    updateSummary();renderFilters();
    $('overview-section').hidden=state.view!=='overview';
    $('overview-hero').hidden=state.view!=='overview';
    $('overview-stats').hidden=state.view!=='overview';
    $('latest').hidden=state.view==='overview'||state.view==='projects';
    $('projects-section').hidden=state.view!=='projects';
    if(state.view==='overview'){renderOverview();return;}
    if(state.view==='projects')return;
    const items=listed();$('result-total').textContent=items.length;
    $('result-context').textContent=state.view==='saved'?'/ 我的收藏':state.view==='recent'?'/ 最近七天':'/ 已按发布时间排序';
    $('result-page').textContent=String(Math.max(1,Math.ceil(Math.min(items.length,state.limit)/12))).padStart(2,'0');
    $('news-grid').innerHTML=items.slice(0,state.limit).map(card).join('');
    document.querySelectorAll('.card-cover img').forEach(img=>img.addEventListener('error',()=>img.remove(),{once:true}));
    $('empty-state').hidden=items.length>0;
    $('load-more').hidden=items.length<=state.limit;
  }
  function reset(){
    Object.assign(state,{view:'all',category:'全部',region:'all',sector:null,search:'',sort:'newest',limit:12});
    $('news-search').value='';$('filter-region').value='all';$('sort-by').value='newest';render();
  }
  function applyFreshData(data){
    if(!data||!Array.isArray(data.articles)||typeof data.updated_at!=='string')throw Error('返回的数据文件不完整');
    const incoming=cleanArticles(data.articles);if(!incoming.length)throw Error('新数据为空，已保留当前新闻');
    const known=new Set(articles.map(a=>a.id));const newItems=incoming.filter(a=>!known.has(a.id)).length;
    payload=data;articles=incoming;
    // Preserve local-only favorite items in an archive even when they expire from the main feed.
    render();
    return newItems;
  }
  async function refreshNews(){
    const btn=$('refresh-button');if(btn.disabled)return;
    btn.disabled=true;btn.textContent='⟳ 检查中…';showNotice('正在读取网站已发布的最新新闻数据…');
    try{
      let fresh;
      if(location.protocol==='file:'){
        // File-origin fetch is usually forbidden; a cache-busted script can still reload the local snapshot.
        await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='./data/news.js?check='+Date.now();script.onload=resolve;script.onerror=()=>reject(Error('无法重新读取本地文件'));document.head.appendChild(script);});
        fresh=window.ARCH_RADAR_DATA;
      }else{
        const res=await fetch('./data/news.json?check='+Date.now(),{cache:'no-store'});
        if(!res.ok)throw Error('HTTP '+res.status);
        fresh=await res.json();
      }
      const before=payload.updated_at;
      const news=applyFreshData(fresh);
      const changed=before!==payload.updated_at;
      const result=location.protocol==='file:'?'本地预览只能重新读取压缩包内的数据；不会联网采集。部署上线并运行 GitHub Actions 后才能测试真正的更新。':news?`已读取最新发布的数据：新增 ${news} 条新闻！最近采集：${updatedTime(payload.updated_at)}。`:changed?`数据重新发布成功，但没有新增文章。最近采集：${updatedTime(payload.updated_at)}。`:`检查完成：暂无新发布的新闻数据。最近采集：${updatedTime(payload.updated_at)}。`;
      showNotice(result,'success');
    }catch(err){showNotice(`刷新失败：${err.message}。现有新闻已保留。请检查网络或稍后重试。`,'error');}
    finally{btn.disabled=false;btn.textContent='↻ 刷新新闻';}
  }
  window.ArchRadar={
    findArticle(id){return articles.find(x=>x.id===id)||archivedFavorites.find(x=>x.id===id);},
    setFavorites(rows){saved=new Set(rows.map(r=>r.article_id));archivedFavorites=rows.map(r=>r.article).filter(a=>a&&a.title&&a.url&&a.id&&a.published);render();},
    openView(view){state.view=view;state.limit=12;state.sector=null;render();window.ArchRadar.onViewChange?.(view);if(view==='overview'||view==='all')window.scrollTo({top:0,behavior:'smooth'});},
    toggleFavorite:null,onViewChange:null,onTrack:null
  };
  document.addEventListener('click',async ev=>{
    const saveBtn=ev.target.closest('[data-save]');
    if(saveBtn){
      const id=saveBtn.dataset.save,next=!saved.has(id);
      if(window.ArchRadar.toggleFavorite){const ok=await window.ArchRadar.toggleFavorite(id,next,window.ArchRadar.findArticle(id));if(!ok)return;}
      if(next)saved.add(id);else saved.delete(id);
      if(!configured){try{localStorage.setItem('ar-favorites-v1',JSON.stringify([...saved]));}catch(_){}}
      render();return;
    }
    const track=ev.target.closest('[data-track]');if(track){window.ArchRadar.onTrack?.(window.ArchRadar.findArticle(track.dataset.track));return;}
    const overviewFilter=ev.target.closest('[data-overview-filter]');
    if(overviewFilter){reset();const kind=overviewFilter.dataset.overviewFilter,value=overviewFilter.dataset.filterValue;
      if(kind==='category')state.category=value;
      if(kind==='region'){state.region=value;$('filter-region').value=value;}
      if(kind==='sector')state.sector=value;
      render();return;
    }
    const cat=ev.target.closest('[data-category]');if(cat){state.category=cat.dataset.category;state.view='all';state.limit=12;state.sector=null;render();return;}
    const view=ev.target.closest('[data-view]');if(view){window.ArchRadar.openView(view.dataset.view);return;}
  });
  $('news-search').addEventListener('input',ev=>{state.search=ev.target.value;state.limit=12;render();});
  $('filter-region').addEventListener('change',ev=>{state.region=ev.target.value;state.limit=12;render();});
  $('sort-by').addEventListener('change',ev=>{state.sort=ev.target.value;state.limit=12;render();});
  $('clear-filters').addEventListener('click',reset);
  $('empty-reset').addEventListener('click',reset);
  $('load-more').addEventListener('click',()=>{state.limit+=12;render();});
  $('refresh-button').addEventListener('click',refreshNews);
  $('actions-url').href='https://github.com/thompsonblue16-lgtm/architecture-radar/actions/workflows/update-news.yml';
  if(!Number(payload.feed_count))showNotice(`当前是 ${articles.length} 条已核对来源的初始精选新闻；需要部署并运行采集任务后才会出现更多实时内容。`,'warning');
  render();
})();
