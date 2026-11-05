/* Architecture Radar collaboration — users' private favorites are NEVER shared. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const config = window.ARCH_RADAR_SUPABASE || {};
  const active = Boolean(config.url && config.anonKey && window.supabase?.createClient);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = url => { try { const u = new URL(url); return /^(https?:)$/.test(u.protocol) ? u.href : null; } catch { return null; } };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const statuses = ['待研究', '跟进中', '已归档'];
  let db = null, user = null, spaces = [], spaceId = '', projects = [], authVersion = 0, inviting = false;
  const inviteFromURL = new URLSearchParams(location.search).get('invite');

  function status(message, error = false) {
    $('collab-feedback').textContent = message;
    $('collab-feedback').classList.toggle('error', error);
  }
  function authStatus(message, error = false) {
    $('auth-feedback').textContent = message;
    $('auth-feedback').classList.toggle('error', error);
  }
  function openAuth() {
    if (!active) {
      window.ArchRadar.openView('projects');
      status('此网站还没有连接多人账号数据库。请先按照 README 配置 Supabase。', true);
      return;
    }
    $('auth-dialog').hidden = false;
    $('auth-email').focus();
  }
  function closeAuth() { $('auth-dialog').hidden = true; }
  function requireLogin() { if (user) return true; openAuth(); return false; }
  function invitationCode(value) {
    let raw = String(value || '').trim();
    try { raw = new URL(raw).searchParams.get('invite') || raw; } catch (_) { /* raw UUID */ }
    return uuid.test(raw) ? raw : null;
  }
  function setAuthUI() {
    $('auth-button').textContent = user ? (user.email || '已登录') : '登录 / 注册';
    $('auth-button').title = user?.email || '使用邮箱登录';
    $('logout-button').hidden = !user;
    $('collab-setup').hidden = active;
    $('collab-login').hidden = !active || Boolean(user);
    $('collab-content').hidden = !active || !user;
  }
  function renderSpaces() {
    $('workspace-select').innerHTML = '<option value="">选择项目空间</option>' + spaces.map(w => `<option value="${safe(w.id)}">${safe(w.name)}</option>`).join('');
    $('workspace-select').value = spaces.some(w => w.id === spaceId) ? spaceId : '';
    const current = spaces.find(w => w.id === spaceId);
    $('workspace-detail').hidden = !current;
    if (!current) return;
    $('workspace-title').textContent = current.name;
    $('invite-rotate').hidden = current.owner_id !== user?.id;
  }
  function renderProjects() {
    $('project-count').textContent = String(projects.length);
    const owner = spaces.find(w => w.id === spaceId)?.owner_id;
    if (!projects.length) {
      $('project-list').innerHTML = '<div class="collab-status">这个空间还没有项目。可以从新闻卡片添加，也可以在上方手动添加。</div>';
      return;
    }
    $('project-list').innerHTML = projects.map(p => {
      const source = safeUrl(p.url);
      const link = source ? `<a href="${safe(source)}" target="_blank" rel="noopener noreferrer">查看原文 ↗</a>` : '';
      const canDelete = p.created_by === user?.id || owner === user?.id;
      return `<article class="project-card" data-project-id="${safe(p.id)}">
        <div class="project-card-top"><span class="project-label">SHARED PROJECT</span><select class="project-status" data-status="${safe(p.id)}" aria-label="项目状态">${statuses.map(s => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <h3>${safe(p.title)}</h3><p class="project-region">⌁ ${safe(p.region || '未指定地区')}</p>
        <p class="project-notes">${safe(p.notes || '暂未添加研究笔记。')}</p>
        <div class="project-footer">${link}<button type="button" data-edit="${safe(p.id)}">编辑笔记</button>${canDelete ? `<button type="button" data-delete="${safe(p.id)}">移除项目</button>` : ''}</div>
        <form class="note-edit-form" data-edit-form="${safe(p.id)}" hidden><label>研究笔记 <textarea maxlength="5000" rows="3" required>${safe(p.notes || '')}</textarea></label><button class="primary-button" type="submit">保存笔记</button><button type="button" data-cancel-edit class="secondary-button">取消</button></form>
      </article>`;
    }).join('');
  }
  async function fetchFavorites(version) {
    const {data,error} = await db.from('ar_favorites').select('article_id,article').eq('user_id', user.id);
    if (version !== authVersion) return;
    if (error) { status('读取个人收藏失败：' + error.message, true); return; }
    window.ArchRadar.setFavorites(data || []);
  }
  async function fetchSpaces(preferred) {
    if (!user) return;
    const version = authVersion;
    const {data,error} = await db.from('ar_workspaces').select('id,name,owner_id,invite_code').order('created_at',{ascending:false});
    if (version !== authVersion) return;
    if (error) { status('加载共享空间失败：' + error.message, true); return; }
    spaces = data || [];
    spaceId = spaces.some(w => w.id === (preferred || spaceId)) ? (preferred || spaceId) : (spaces[0]?.id || '');
    renderSpaces();
    await fetchProjects();
  }
  async function fetchProjects() {
    if (!user || !spaceId) { projects = []; renderProjects(); return; }
    const requestedSpace = spaceId;
    const version = authVersion;
    const {data,error} = await db.from('ar_projects').select('id,workspace_id,created_by,article_id,title,url,region,status,notes,created_at').eq('workspace_id',requestedSpace).order('created_at',{ascending:false}).limit(250);
    if (requestedSpace !== spaceId || version !== authVersion) return;
    if (error) { status('加载项目失败：' + error.message,true); return; }
    projects = data || [];
    renderProjects();
  }
  async function join(code) {
    if (!requireLogin()) return false;
    const checked = invitationCode(code);
    if (!checked) { status('邀请链接或邀请码格式不正确。', true); return false; }
    const {data,error} = await db.rpc('ar_join_workspace',{p_invite_code:checked});
    if (error) { status('无法加入：' + error.message, true); return false; }
    await fetchSpaces(data);
    status('已经加入共享空间。你的个人收藏仍然只有自己可见。');
    return true;
  }
  async function onSession(session) {
    const version = ++authVersion;
    user = session?.user || null;
    spaces = []; spaceId = ''; projects = [];
    window.ArchRadar.setFavorites([]);
    setAuthUI(); renderSpaces(); renderProjects();
    if (!user) return;
    closeAuth();
    await Promise.all([fetchFavorites(version),fetchSpaces()]);
    if (version !== authVersion) return;
    if (inviteFromURL && !inviting) {
      inviting = true;
      const joined = await join(inviteFromURL);
      if (joined) { history.replaceState(null,'',location.pathname + location.hash); window.ArchRadar.openView('projects'); }
    }
  }
  $('auth-button').addEventListener('click', () => { if (!user) openAuth(); else window.ArchRadar.openView('projects'); });
  $('logout-button').addEventListener('click', async () => {
    if (db) { const {error} = await db.auth.signOut(); if (error) status('退出失败：'+error.message,true); }
  });
  $('auth-close').addEventListener('click',closeAuth);
  $('auth-dialog').addEventListener('click',ev => {if (ev.target === $('auth-dialog')) closeAuth();});
  document.addEventListener('keydown',ev => { if (ev.key === 'Escape') closeAuth(); });
  $('collab-login-button').addEventListener('click',openAuth);
  $('auth-form').addEventListener('submit',async ev => {
    ev.preventDefault();
    if (!db) return;
    const email = $('auth-email').value.trim();
    const submit = $('auth-form').querySelector('[type="submit"]'); submit.disabled = true;
    authStatus('正在发送登录邮件…');
    const {error} = await db.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin + location.pathname + location.search}});
    submit.disabled = false;
    authStatus(error ? ('发送失败：' + error.message) : '登录链接已发送。请检查邮箱并点击链接返回网站。',Boolean(error));
  });
  $('workspace-select').addEventListener('change',async ev => { spaceId = ev.target.value; renderSpaces(); await fetchProjects(); });
  $('workspace-new-button').addEventListener('click',()=>{$('workspace-join-form').hidden=true;$('workspace-new-form').hidden = !$('workspace-new-form').hidden;});
  $('workspace-join-button').addEventListener('click',()=>{$('workspace-new-form').hidden=true;$('workspace-join-form').hidden = !$('workspace-join-form').hidden;});
  document.querySelectorAll('[data-close-form]').forEach(b => b.addEventListener('click',()=>{b.closest('form').hidden=true;}));
  $('workspace-new-form').addEventListener('submit',async ev => {
    ev.preventDefault(); if (!requireLogin()) return;
    const name = $('workspace-new-name').value.trim();
    if (!name) return;
    const {data,error} = await db.from('ar_workspaces').insert({name,owner_id:user.id}).select('id').single();
    if (error) { status('创建空间失败：'+error.message,true); return; }
    $('workspace-new-form').hidden = true; $('workspace-new-name').value = '';
    await fetchSpaces(data.id); status('空间创建成功，可以复制邀请链接给朋友。');
  });
  $('workspace-join-form').addEventListener('submit',async ev => {
    ev.preventDefault(); const ok=await join($('workspace-invite-code').value);
    if (ok) { $('workspace-join-form').hidden=true; $('workspace-invite-code').value=''; }
  });
  $('invite-copy').addEventListener('click',async () => {
    const current=spaces.find(w=>w.id===spaceId); if (!current) return;
    const link = location.origin + location.pathname + '?invite=' + current.invite_code;
    try { await navigator.clipboard.writeText(link); status('邀请链接已复制。发送给朋友后，对方登录即可加入这个空间。'); }
    catch (_) { status('浏览器无法自动复制，请手动复制此链接：'+link); }
  });
  $('invite-rotate').addEventListener('click',async () => {
    const current=spaces.find(w=>w.id===spaceId); if (!current || !confirm('更换后，之前分享的邀请链接将失效。确定继续？')) return;
    const {data,error} = await db.rpc('ar_rotate_invite',{p_workspace_id:spaceId});
    if (error) { status('更换失败：'+error.message,true); return; }
    current.invite_code = data; status('邀请链接已更新，旧链接已失效。');
  });
  $('project-add-form').addEventListener('submit',async ev => {
    ev.preventDefault(); if (!requireLogin() || !spaceId) return;
    const title=$('project-title').value.trim(), rawUrl=$('project-url').value.trim(), url=rawUrl?safeUrl(rawUrl):null;
    if (!title || (rawUrl && !url)) {status('请填写项目名称和有效的 http(s) 来源链接。',true);return;}
    const {error} = await db.from('ar_projects').insert({workspace_id:spaceId,created_by:user.id,title,url,region:$('project-region').value.trim(),notes:$('project-notes').value.trim()});
    if (error) { status('添加项目失败：'+error.message,true); return; }
    $('project-add-form').reset(); await fetchProjects(); status('项目已加入共享空间。');
  });
  $('project-refresh').addEventListener('click',fetchProjects);
  $('project-list').addEventListener('change',async ev => {
    const el=ev.target.closest('[data-status]'); if (!el || !statuses.includes(el.value)) return;
    const {error} = await db.from('ar_projects').update({status:el.value}).eq('id',el.dataset.status).eq('workspace_id',spaceId);
    if (error) {status('状态更新失败：'+error.message,true);await fetchProjects();} else status('项目状态已更新。');
  });
  $('project-list').addEventListener('click',async ev => {
    const edit=ev.target.closest('[data-edit]');
    if (edit) { $('project-list').querySelectorAll('[data-edit-form]').forEach(f=>{f.hidden=f.dataset.editForm!==edit.dataset.edit;}); return; }
    const cancel=ev.target.closest('[data-cancel-edit]'); if (cancel) { cancel.closest('form').hidden=true; return; }
    const remove=ev.target.closest('[data-delete]');
    if (remove && confirm('确定从共享空间中移除这个项目？个人收藏不会受到影响。')) {
      const {error}=await db.from('ar_projects').delete().eq('id',remove.dataset.delete).eq('workspace_id',spaceId);
      if (error) status('删除失败：'+error.message,true);
      else {await fetchProjects();status('共享项目已移除。');}
    }
  });
  $('project-list').addEventListener('submit',async ev => {
    const form=ev.target.closest('[data-edit-form]'); if (!form) return;
    ev.preventDefault();
    const {error}=await db.from('ar_projects').update({notes:form.querySelector('textarea').value.trim()}).eq('id',form.dataset.editForm).eq('workspace_id',spaceId);
    if (error) status('保存笔记失败：'+error.message,true);
    else {await fetchProjects();status('共享笔记已保存。');}
  });
  window.ArchRadar.onTrack = article => {
    if (!article) return;
    window.ArchRadar.openView('projects');
    if (!requireLogin()) return;
    $('project-title').value = article.title;
    $('project-url').value = safeUrl(article.url) || '';
    $('project-region').value = article.region || '';
    $('project-notes').value = `${article.source || '来源'} · ${article.category || '建筑资讯'} · ${article.published?.slice(0,10) || ''}`;
    if (!spaceId) status('请先创建或加入一个共享空间，再添加这条新闻为项目。');
    else $('project-title').focus();
  };
  window.ArchRadar.toggleFavorite = async (id, next, article) => {
    if (!active) return true; // local-only mode handled by main app
    if (!requireLogin()) return false;
    if (!article) return false;
    const query = next
      ? db.from('ar_favorites').insert({user_id:user.id,article_id:id,article})
      : db.from('ar_favorites').delete().eq('user_id',user.id).eq('article_id',id);
    const {error} = await query;
    if (error) { status('个人收藏保存失败：'+error.message,true); return false; }
    return true;
  };
  if (!active) {
    setAuthUI();
    return;
  }
  db=window.supabase.createClient(config.url,config.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  db.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
      // Async DB calls outside the auth callback avoid the client's lock.
      setTimeout(()=>onSession(session), 0);
    }
  });
})();
