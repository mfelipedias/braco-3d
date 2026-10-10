// Peças de interface que não dependem da simulação: avisos, abas, painéis recolhíveis,
// tela de carregamento e ajuda. Preferências de interface ficam salvas neste navegador.

const UI_STORE = 'braco3d.ui.v1';
const prefs = (() => { try { return JSON.parse(localStorage.getItem(UI_STORE)) ?? {}; } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem(UI_STORE, JSON.stringify(prefs)); } catch {} };

// ---------------------------------------------------------------- aviso (status)
// say('texto')            informação
// say('texto', 'warn')    algo bloqueou o movimento (colisão, alcance)
// say('texto', 'ok')      ação concluída
// say('')                 limpa
const toast = document.getElementById('status');
let toastTimer = 0;
export function say(text, kind = 'info') {
  clearTimeout(toastTimer);
  if (!text) { toast.classList.remove('show'); return; }
  toast.textContent = text;
  toast.dataset.kind = kind;
  toast.classList.add('show');
  // mensagens de progresso ("Pegando…") ficam até a próxima; as demais somem sozinhas
  if (!text.endsWith('…')) toastTimer = setTimeout(() => toast.classList.remove('show'), kind === 'warn' ? 4500 : 3000);
}

// ---------------------------------------------------------------- abas
export function setupTabs() {
  const tabs = [...document.querySelectorAll('[role=tab]')];
  const select = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (focus) tab.focus();
    prefs.tab = tab.id;
    savePrefs();
  };
  tabs.forEach((t, i) => {
    t.onclick = () => select(t);
    t.onkeydown = (e) => {
      const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      select(tabs[(i + d + tabs.length) % tabs.length], true);
    };
  });
  select(tabs.find((t) => t.id === prefs.tab) ?? tabs[0]);
}

// ---------------------------------------------------------------- painéis recolhíveis
export function setupPanels() {
  const narrow = matchMedia('(max-width: 760px)').matches;
  for (const panel of document.querySelectorAll('.panel')) {
    const btn = panel.querySelector('.collapse');
    const set = (collapsed) => {
      panel.classList.toggle('collapsed', collapsed);
      btn.setAttribute('aria-expanded', !collapsed);
      btn.title = collapsed ? 'Expandir painel' : 'Recolher painel';
    };
    // no celular o painel de gestos começa recolhido para sobrar espaço para a cena
    set(prefs.collapsed?.[panel.id] ?? (narrow && panel.id === 'gPanel'));
    btn.onclick = () => {
      set(!panel.classList.contains('collapsed'));
      prefs.collapsed = { ...prefs.collapsed, [panel.id]: panel.classList.contains('collapsed') };
      savePrefs();
    };
  }
}

// ---------------------------------------------------------------- carregamento
const loaderEl = document.getElementById('loader');
export function loadProgress(frac, text) {
  loaderEl.querySelector('.meter i').style.width = `${Math.round(frac * 100)}%`;
  if (text) loaderEl.querySelector('.msg').textContent = text;
}
export function loadDone() {
  loaderEl.classList.add('done');
  setTimeout(() => loaderEl.remove(), 600);
}
export function loadFailed(err) {
  loaderEl.classList.add('failed');
  loaderEl.querySelector('.msg').textContent =
    `Não foi possível carregar a cena (${err?.message ?? err}). Verifique a conexão e recarregue a página.`;
  loaderEl.querySelector('.retry').hidden = false;
  loaderEl.querySelector('.retry').onclick = () => location.reload();
}

// ---------------------------------------------------------------- ajuda e guia de treino
export function setupHelp() {
  const dlg = document.getElementById('help');
  document.getElementById('helpBtn').onclick = () => dlg.showModal();
  document.getElementById('gTrainBtn').onclick = () => document.getElementById('train').showModal();
  for (const d of document.querySelectorAll('dialog')) {
    d.querySelector('.close').onclick = () => d.close();
    d.onclick = (e) => { if (e.target === d) d.close(); };  // clique fora fecha
  }
  if (!prefs.seenHelp) {
    prefs.seenHelp = true;
    savePrefs();
    return () => dlg.showModal();  // abre na primeira visita, depois que a cena carregar
  }
  return () => {};
}
