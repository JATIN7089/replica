// ============================================================================
// Northhold — HUD: resource bar, contextual panel, build catalog, modals
// ============================================================================
import {
  RESOURCE_META, BUILDINGS, BUILD_ORDER, UNITS, TRAINABLE, CLANS, DIFFICULTY,
  BLESSINGS, BLESSING_COST, VICTORY, MAX_BLESSINGS, TERRAIN, WARCHIEF_FAME,
} from './data.js';
import * as E from './engine.js';

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 0) => {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 10000) return Math.round(v / 1000) + 'k';
  return d > 0 && abs < 100 ? v.toFixed(d) : String(Math.round(v));
};
const sign = (n, d = 1) => (n >= 0 ? '+' : '') + fmt(n, d);
const costText = (cost) => Object.entries(cost)
  .map(([k, v]) => `${RESOURCE_META[k].icon}${Math.round(v)}`).join(' ');

export function createUI(app) {
  const nodes = {
    resources: $('resources'),
    season: $('seasonChip'),
    clanLabel: $('clanLabel'),
    panel: $('panelBody'),
    catalog: $('buildCatalog'),
    orders: $('orders'),
    toasts: $('toasts'),
    log: $('log'),
    blessingModal: $('blessingModal'),
    blessingChoices: $('blessingChoices'),
    gameOver: $('gameOver'),
    goTitle: $('goTitle'),
    goText: $('goText'),
    goStats: $('goStats'),
    help: $('helpModal'),
  };

  let chipNodes = null;
  let panelSig = '';
  let catalogSig = '';
  let ordersSig = '';
  let toastSig = '';
  let logSig = '';
  let blessingSig = '';
  let overSig = '';

  // ---------------- start screen ----------------
  function buildStartScreen(onStart) {
    const clanGrid = $('clanChoices');
    const diffGrid = $('diffChoices');
    let clanId = 'wolf';
    let diffId = 'normal';

    clanGrid.innerHTML = Object.values(CLANS).map((c) => `
      <button class="choice ${c.id === clanId ? 'sel' : ''}" data-clan="${c.id}">
        <div class="t"><span class="swatch" style="background:${c.color}"></span>${c.name}</div>
        <div class="d">“${c.motto}”</div>
        <div class="b">${c.bonus}</div>
      </button>`).join('');
    diffGrid.innerHTML = Object.values(DIFFICULTY).map((d) => `
      <button class="choice ${d.id === diffId ? 'sel' : ''}" data-diff="${d.id}">
        <div class="t">${d.name}</div>
        <div class="d">${d.desc}</div>
      </button>`).join('');

    const sync = () => {
      clanGrid.querySelectorAll('[data-clan]').forEach((b) => b.classList.toggle('sel', b.dataset.clan === clanId));
      diffGrid.querySelectorAll('[data-diff]').forEach((b) => b.classList.toggle('sel', b.dataset.diff === diffId));
    };
    clanGrid.onclick = (e) => {
      const b = e.target.closest('[data-clan]');
      if (!b) return;
      clanId = b.dataset.clan; sync();
    };
    diffGrid.onclick = (e) => {
      const b = e.target.closest('[data-diff]');
      if (!b) return;
      diffId = b.dataset.diff; sync();
    };
    return { get: () => ({ clanId, difficulty: diffId }) };
  }

  // ---------------- resource bar ----------------
  function buildChips() {
    const st = app.state;
    const keys = ['food', 'wood', 'krown', 'stone', 'iron', 'lore'];
    nodes.resources.innerHTML =
      keys.map((k) => `<div class="chip" data-res="${k}">
        <span class="ic">${RESOURCE_META[k].icon}</span>
        <span class="val"></span><span class="delta"></span></div>`).join('')
      + `<div class="chip pop"><span class="ic">👥</span><span class="val"></span>
           <span class="bar"><i></i></span></div>`
      + `<div class="chip happy"><span class="face">😄</span><span class="val"></span></div>`
      + `<div class="chip"><span class="ic">⭐</span><span class="val"></span></div>`
      + `<div class="chip"><span class="ic">⚔️</span><span class="val"></span></div>`;
    chipNodes = {};
    for (const k of keys) {
      const row = nodes.resources.querySelector(`[data-res="${k}"]`);
      chipNodes[k] = { val: row.querySelector('.val'), delta: row.querySelector('.delta') };
    }
    const p = nodes.resources.querySelector('.chip.pop');
    chipNodes.pop = { val: p.querySelector('.val'), bar: p.querySelector('.bar i') };
    const hp = nodes.resources.querySelector('.chip.happy');
    chipNodes.happy = { face: hp.querySelector('.face'), val: hp.querySelector('.val') };
    const fame = nodes.resources.children[7];
    chipNodes.fame = { val: fame.querySelector('.val') };
    const band = nodes.resources.children[8];
    chipNodes.band = { val: band.querySelector('.val') };
    nodes.clanLabel.textContent = st.clans[st.playerClan].name;
  }

  function updateStats() {
    const st = app.state;
    const clan = st.clans[st.playerClan];
    const mine = E.rates(st, clan);
    const smooth = app.smooth;
    for (const k of ['food', 'wood', 'krown', 'stone', 'iron', 'lore']) {
      const n = chipNodes[k];
      n.val.textContent = fmt(clan.res[k]);
      let rate = k === 'food' ? mine.netFood : k === 'krown' ? mine.netKrown : mine[k];
      smooth[k] = (smooth[k] || 0) * 0.9 + rate * 0.1;
      const s = smooth[k];
      const cl = Math.abs(s) < 0.08 ? 'flat' : s > 0 ? 'up' : 'down';
      n.delta.textContent = cl === 'flat' ? '' : sign(s, 1);
      n.delta.className = 'delta ' + cl;
    }
    const pop = E.totalPop(st, clan);
    const cap = E.popCap(st, clan);
    chipNodes.pop.val.textContent = `${pop}/${cap}`;
    chipNodes.pop.bar.style.width = `${cap ? Math.min(100, (pop / cap) * 100) : 100}%`;
    const happy = Math.round(clan.happiness);
    chipNodes.happy.val.textContent = `${happy}%`;
    chipNodes.happy.face.textContent = happy > 80 ? '😄' : happy > 60 ? '🙂' : happy > 40 ? '😐' : happy > 20 ? '🙁' : '😡';
    chipNodes.fame.val.textContent = fmt(clan.fame) + '/' + VICTORY.fame;
    chipNodes.band.val.textContent = `${E.warbandOf(st, clan.id)}/${E.warbandCap(st, clan)}`;
  }

  function updateSeason() {
    const st = app.state;
    const season = E.seasonOf(st);
    const monthInSeason = E.monthOfSeason(st);
    const prog = (st.time.monthProgress / 6);
    nodes.season.innerHTML = `<span>${season.icon}</span>
      <span>${season.name}</span>
      <small>Year ${E.yearOf(st)} · Month ${monthInSeason + 1}${prog > 0 ? '' : ''}</small>`;
    nodes.season.style.borderColor = season.color + '88';
  }

  // ---------------- panel ----------------
  function buildingKwargs() { return ''; }

  function panelSignature() {
    const st = app.state;
    const ui = app.ui;
    const clan = st.clans[st.playerClan];
    const b = ui.selectedBuildingId != null ? st.buildingsById.get(ui.selectedBuildingId) : null;
    const ids = [...ui.selectedUnits].sort().join(',');
    const bt = b ? `${b.id}:${b.workers}:${b.done ? 1 : 0}:${Math.round(b.hp)}` : '-';
    const hover = ui.hoverTile ? ui.hoverTile.id + ui.hoverTile.terrain + ui.hoverTile.owner : '-';
    return [
      ui.mode, ids, bt, hover,
      Math.round(clan.fame), Math.round(clan.res.lore), Math.round(clan.res.food / 10),
      clan.blessings.join(','), E.warbandOf(st, clan.id), E.popCap(st, clan),
      clan.villagers.idle, clan.training.length, st.time.month,
    ].join('|');
  }

  function renderPanel() {
    const st = app.state;
    const ui = app.ui;
    const clan = st.clans[st.playerClan];
    const selBuilding = ui.selectedBuildingId != null ? st.buildingsById.get(ui.selectedBuildingId) : null;

    if (selBuilding) {
      const def = BUILDINGS[selBuilding.type];
      const tile = E.tileById(st, selBuilding.tileId);
      const mine = selBuilding.clan === clan.id;
      const rates = mine ? E.rates(st, clan) : null;
      let body = `
        <h3>${def.icon} ${def.name} ${mine ? '' : '<span class="tag bad">enemy</span>'}</h3>
        <div class="sub">${def.desc}</div>
        <div class="row"><span class="stat">Condition</span>
          <span class="stat">${Math.round(selBuilding.hp)} / ${selBuilding.maxHp} HP</span></div>
        <div class="row"><span class="stat">Tile</span>
          <span class="tag">${TERRAIN[tile.terrain].name}</span></div>`;

      if (!selBuilding.done) {
        body += `<div class="row"><span class="stat">Status</span>
          <span class="tag gold">🔨 ${Math.max(0, selBuilding.build).toFixed(0)}s left</span></div>`;
      }

      if (mine && def.slots > 0) {
        const per = def.rate > 0 ? def.rate * (selBuilding.workers || 0) : 0;
        const resLabel = def.res ? `${RESOURCE_META[def.res].icon} ${per.toFixed(1)}/mo` : '—';
        body += `<h4>Workers</h4>
          <div class="row"><span class="stat">Assigned</span>
            <span class="tag">${selBuilding.workers || 0} / ${def.slots}</span></div>
          <div class="row"><span class="stat">Output</span>
            <span class="stat">${resLabel}</span></div>
          <div class="workerpicker">
            <button data-job="-3">−3</button>
            <button data-job="-1">−</button>
            <span class="count">${selBuilding.workers || 0}</span>
            <button data-job="1">+</button>
            <button data-job="3">+3</button>
            <button data-job="max">Max</button>
          </div>`;
        if (def.deposit) {
          body += `<div class="row"><span class="stat">Deposit left</span>
            <span class="stat">${Math.round(tile.deposit)} / ${tile.depositMax}</span></div>`;
        }
        if (def.tower) {
          body += `<div class="row"><span class="stat">Tower fire</span>
            <span class="stat">${selBuilding.workers > 0 ? 'active' : '⚠︎ needs a worker'}</span></div>`;
        }
        if (def.smith) {
          body += `<div class="row"><span class="stat">Wargear bonus</span>
            <span class="stat">+${Math.round((clan.smithBonus || 0) * 100)}%</span></div>`;
        }
      }

      if (mine && def.train) {
        body += `<h4>Recruit</h4><div class="joblist">`;
        for (const t of TRAINABLE) {
          const c = E.canTrain(st, clan, t);
          const cst = E.canTrain(st, clan, t).cost || UNITS[t].cost;
          body += `<button class="jobbtn" data-train="${t}" ${E.canTrain(st, clan, t).ok ? '' : 'disabled'}>
            <span class="l">${UNITS[t].icon} ${UNITS[t].name}</span>
            <small>${costText(cst)} · ${UNITS[t].train}s</small></button>`;
        }
        if (selBuilding.type === 'townhall') {
          const wc = E.canTrain(st, clan, 'warchief');
          body += `<button class="jobbtn" data-train="warchief" ${wc.ok ? '' : 'disabled'}>
            <span class="l">👑 Warchief</span>
            <small>${WARCHIEF_FAME} fame${wc.ok ? '' : ' · ' + (wc.reason || '')}</small></button>`;
          const sc = E.canTrain(st, clan, 'scout');
          body += `<button class="jobbtn" data-train="scout" ${sc.ok ? '' : 'disabled'}>
            <span class="l">🧭 Scout</span><small>${costText(UNITS.scout.cost)} · ${UNITS.scout.train}s</small></button>`;
        }
        body += `</div>`;
      }
      if (mine) {
        body += `<h4>Orders</h4><div class="joblist">
          <button class="jobbtn" data-act="demolish"><span class="l">🗑 Demolish</span>
            <small>+half wood back</small></button></div>`;
      } else {
        body += `<h4>Orders</h4><div class="joblist">
          <button class="jobbtn" data-act="attack-target"><span class="l">⚔️ Attack this building</span></button></div>`;
      }
      if (clan.training.length) {
        body += `<h4>In training</h4>`;
        for (const t of clan.training) {
          body += `<div class="row"><span class="stat">${UNITS[t.type].icon} ${UNITS[t.type].name}</span>
            <span class="tag gold">${Math.max(0, t.remaining).toFixed(0)}s</span></div>`;
        }
      }
      nodes.panel.innerHTML = body;
      bindPanel(selBuilding);
      return;
    }

    const selIds = [...ui.selectedUnits].filter((id) => st.unitById.get(id));
    if (selIds.length) {
      const counts = {};
      let hp = 0, maxHp = 0;
      for (const id of selIds) {
        const u = st.unitById.get(id);
        counts[u.type] = (counts[u.type] || 0) + 1;
        hp += u.hp; maxHp += u.maxHp;
      }
      const first = st.unitById.get(selIds[0]);
      const tile = E.tileById(st, first.tileId);
      let body = `<h3>⚔️ Warband <span class="tag">${selIds.length} selected</span></h3>
        <div class="kv">`;
      for (const [t, n] of Object.entries(counts)) {
        body += `<span class="k">${UNITS[t].icon} ${UNITS[t].name}</span><span class="v">${n}</span>`;
      }
      body += `<span class="k">Health</span><span class="v">${Math.round(hp)} / ${Math.round(maxHp)}</span>
        <span class="k">Standing on</span><span class="v">${TERRAIN[tile.terrain].name}</span>
        <span class="k">Order</span><span class="v">${first.order}</span></div>
        <h4>Orders</h4><div class="joblist">
          <button class="jobbtn" data-act="move"><span class="l">➤ Move</span><small>then tap a tile</small></button>
          <button class="jobbtn" data-act="hold"><span class="l">🛡 Hold ground</span></button>
          <button class="jobbtn" data-act="select-all"><span class="l">👥 Select all warriors</span></button>
          <button class="jobbtn" data-act="home"><span class="l">🏛 Send home</span></button>
        </div>`;
      nodes.panel.innerHTML = body;
      bindPanel(null);
      return;
    }

    // overview
    const rates = E.rates(st, clan);
    const jobs = {};
    for (const b of E.allBuildings(st, clan.id)) {
      const def = BUILDINGS[b.type];
      if (def.job && b.workers) jobs[def.job] = (jobs[def.job] || 0) + b.workers;
    }
    const jobLabel = {
      woodcutter: '🪵 Woodcutters', hunter: '🏹 Hunters', farmer: '🌾 Farmers', fisher: '🐟 Fishers',
      miner: '⛏ Miners', smith: '⚒ Smith', merchant: '🏪 Merchants', brewer: '🍺 Brewer',
      loremaster: '📜 Loremaster', trainer: '🛡 Trainer', archer: '🏹 Archer', trader: '⚖️ Trader',
    };
    let body = `<h3>${clan.banner ? '' : ''}🛡 ${clan.name}</h3>
      <div class="sub">${clan.mottoText || ''}</div>
      <h4>Victory progress</h4>
      <div class="row"><span class="stat">⭐ Fame</span>
        <span class="stat">${Math.round(clan.fame)} / ${VICTORY.fame}</span></div>
      <div class="row"><span class="stat">🪙 Krowns earned</span>
        <span class="stat">${Math.round(clan.totalKrowns)} / ${VICTORY.krowns}</span></div>
      <div class="row"><span class="stat">🗿 Lore</span>
        <span class="stat">${Math.round(clan.res.lore)} / ${BLESSING_COST}${
          clan.blessings.length >= MAX_BLESSINGS ? ' · full' : ''}</span></div>
      <h4>Clan</h4>
      <div class="statlist">
        <div><span>Villagers idle</span><span>${clan.villagers.idle}</span></div>
        <div><span>Working</span><span>${E.assignedWorkers(st, clan)}</span></div>
        <div><span>Warband</span><span>${E.warbandOf(st, clan.id)}/${E.warbandCap(st, clan)}</span></div>
        <div><span>Happiness</span><span>${Math.round(clan.happiness)}%</span></div>
      </div>
      <h4>Jobs</h4><div class="kv">`;
    const jobKeys = Object.keys(jobs);
    if (!jobKeys.length) body += `<span class="k">Nobody is working yet</span><span class="v">—</span>`;
    for (const k of jobKeys) body += `<span class="k">${jobLabel[k] || k}</span><span class="v">${jobs[k]}</span>`;
    body += `</div>`;

    if (clan.blessings.length) {
      body += `<h4>Blessings</h4><div class="row" style="flex-wrap:wrap;gap:5px">`;
      for (const b of clan.blessings) body += `<span class="tag gold">${BLESSINGS[b].icon} ${BLESSINGS[b].name}</span>`;
      body += `</div>`;
    }

    if (ui.hoverTile) {
      const t = ui.hoverTile;
      const owner = t.owner == null ? 'Unclaimed' : st.clans[t.owner].name + (t.owner === st.playerClan ? ' (you)' : '');
      body += `<h4>Tile ${t.q},${t.r}</h4>
        <div class="kv">
          <span class="k">Terrain</span><span class="v">${TERRAIN[t.terrain].name}</span>
          <span class="k">Owner</span><span class="v">${owner}</span>
          ${t.depositMax ? `<span class="k">Deposit</span><span class="v">${Math.round(t.deposit)}/${t.depositMax}</span>` : ''}
          ${t.terrain === 'ruins' ? `<span class="k">Ruins</span><span class="v">${t.ruinLooted ? 'explored' : 'send a warrior!'}</span>` : ''}
        </div>
        <div class="sub" style="margin-top:6px">${TERRAIN[t.terrain].blurb}</div>`;
      if (t.owner == null) {
        const c = E.canColonize(st, t, clan);
        body += `<button class="jobbtn" data-act="colonize" ${c.ok ? '' : 'disabled'}>
          <span class="l">⛳ Settle this tile</span>
          <small>${c.ok ? costText({ food: c.cost }) : (c.reason || '')}</small></button>`;
      }
    }
    body += `<h4>Passive</h4><div class="kv">
      <span class="k">Food per month</span><span class="v">${rates.food.toFixed(1)}</span>
      <span class="k">Eaten per month</span><span class="v">−${rates.useFood.toFixed(1)}</span>
      <span class="k">Krown upkeep</span><span class="v">−${rates.useKrown.toFixed(1)}</span>
    </div>`;
    nodes.panel.innerHTML = body;
    bindPanel(null);
  }

  function bindPanel(selBuilding) {
    const st = app.state;
    const clan = st.clans[st.playerClan];
    nodes.panel.querySelectorAll('[data-job]').forEach((b) => {
      b.onclick = () => {
        if (!selBuilding) return;
        const def = BUILDINGS[selBuilding.type];
        const max = def.slots || 0;
        const v = b.dataset.job;
        if (v === 'max') E.setJob(st, selBuilding.id, max);
        else E.setJob(st, selBuilding.id, Math.max(0, Math.min(max, (selBuilding.workers || 0) + Number(v))));
      };
    });
    nodes.panel.querySelectorAll('[data-train]').forEach((b) => {
      b.onclick = () => {
        const r = E.trainUnit(st, b.dataset.train);
        if (!r.ok && r.reason) E.addToast(st, r.reason, 'bad');
      };
    });
    nodes.panel.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => doAction(b.dataset.act, selBuilding);
    });
  }

  function doAction(act, selBuilding) {
    const st = app.state;
    const ui = app.ui;
    const clan = st.clans[st.playerClan];
    switch (act) {
      case 'move': ui.mode = 'move'; break;
      case 'colonize': ui.mode = 'colonize'; break;
      case 'hold': for (const id of ui.selectedUnits) E.holdUnit(st, id); break;
      case 'select-all': {
        const ids = E.unitsOf(st, clan.id).filter((u) => UNITS[u.type].warband).map((u) => u.id);
        ui.selectedUnits = new Set(ids);
        break;
      }
      case 'home': {
        const th = E.buildingsOf(st, clan.id, 'townhall')[0];
        if (th) {
          const ids = [...ui.selectedUnits];
          E.commandMove(st, ids, th.tileId);
        }
        break;
      }
      case 'demolish': if (selBuilding) E.demolish(st, selBuilding.id); ui.selectedBuildingId = null; break;
      case 'attack-target': {
        const ids = [...ui.selectedUnits];
        if (!ids.length) { E.addToast(st, 'Select warriors first', 'bad'); break; }
        E.commandAttack(st, ids, null, selBuilding.id, selBuilding.tileId);
        break;
      }
      default: break;
    }
  }

  // ---------------- build catalog ----------------
  function renderCatalog() {
    const st = app.state;
    const clan = st.clans[st.playerClan];
    const owned = st.tiles.filter((t) => t.owner === clan.id);
    nodes.catalog.innerHTML = BUILD_ORDER.map((type) => {
      const def = BUILDINGS[type];
      const cost = E.buildingCost(st, clan, type);
      const placeable = owned.some((t) => E.canBuild(st, t, clan, type).ok);
      const affordable = Object.entries(cost).every(([k, v]) => (clan.res[k] || 0) >= v);
      const cnt = E.countBuilding(st, clan.id, type);
      const limited = cnt >= (def.limit || 99);
      const locked = !placeable;
      const armed = app.ui.mode === 'build' && app.ui.buildType === type;
      return `<div class="bcard ${armed ? 'armed' : ''} ${locked || limited ? 'locked' : ''}"
        data-build="${type}" title="${def.name} — ${def.desc}">
        <span class="ic">${def.icon}</span>
        <span class="nm">${def.name}${def.limit && def.limit < 90 ? ` ${cnt}/${def.limit}` : ''}</span>
        <span class="cost">${limited ? 'limit' : (!affordable ? '⚠︎ ' : '') + (costText(cost) || 'free')}</span>
      </div>`;
    }).join('');
    nodes.catalog.querySelectorAll('[data-build]').forEach((el) => {
      el.onclick = () => {
        const type = el.dataset.build;
        const st2 = app.state;
        const clan2 = st2.clans[st2.playerClan];
        if (st2.tiles.filter((t) => t.owner === clan2.id).every((t) => !E.canBuild(st2, t, clan2, type).ok)) {
          E.addToast(st2, `Cannot place ${BUILDINGS[type].name} here yet`, 'bad');
          return;
        }
        app.ui.mode = 'build';
        app.ui.buildType = type;
        app.ui.selectedBuildingId = null;
      };
    });
  }

  // ---------------- orders bar ----------------
  function renderOrders() {
    const st = app.state;
    const clan = st.clans[st.playerClan];
    const items = [
      { a: 'colonize', label: '⛳ Settle (C)', dis: false },
      { a: 'move', label: '➤ Move (M)', dis: !app.ui.selectedUnits.size },
      { a: 'stop', label: '✋ Stop', dis: !app.ui.selectedUnits.size },
      { a: 'home', label: '🏛 Home (H)', dis: false },
    ];
    let html = items.map((i) => `<button data-order="${i.a}" ${i.dis ? 'disabled' : ''}>${i.label}</button>`).join('');
    html += `<button data-order="train:warrior" ${E.canTrain(st, clan, 'warrior').ok ? '' : 'disabled'}>⚔️ Warrior</button>`;
    html += `<button data-order="train:axe" ${E.canTrain(st, clan, 'axe').ok ? '' : 'disabled'}>🪓 Axe</button>`;
    html += `<button data-order="train:shield" ${E.canTrain(st, clan, 'shield').ok ? '' : 'disabled'}>🛡 Shield</button>`;
    html += `<button data-order="train:scout" ${E.canTrain(st, clan, 'scout').ok ? '' : 'disabled'}>🧭 Scout</button>`;
    html += `<button data-order="pause">${st.time.paused ? '▶ Resume' : '⏸ Pause'}</button>`;
    if (app.ui.mode !== 'select') html += `<button data-order="cancel" class="active">✕ Cancel (Esc)</button>`;
    nodes.orders.innerHTML = html;
    nodes.orders.querySelectorAll('[data-order]').forEach((el) => {
      el.onclick = () => {
        const o = el.dataset.order;
        if (o.startsWith('train:')) {
          const r = E.trainUnit(st, o.split(':')[1]);
          if (!r.ok && r.reason) E.addToast(st, r.reason, 'bad');
          return;
        }
        if (o === 'pause') { app.togglePause(); return; }
        doAction(o, null);
      };
    });
  }

  // ---------------- toasts / log ----------------
  function renderToasts() {
    const st = app.state;
    const sig = st.toasts.map((t) => t.msg + t.kind).join('|');
    if (sig === toastSig) return;
    toastSig = sig;
    nodes.toasts.innerHTML = st.toasts.slice(-4).map((t) =>
      `<div class="toast ${t.kind === 'good' ? 'good' : t.kind === 'bad' ? 'bad' : ''}">${t.msg}</div>`).join('');
  }

  function renderLog() {
    const st = app.state;
    const last = st.log[st.log.length - 1];
    const sig = last ? last.id : '0';
    if (sig === logSig) return;
    logSig = sig;
    nodes.log.innerHTML = st.log.slice(-6).map((l) =>
      `<div class="${l.kind}">${l.msg}</div>`).join('');
  }

  // ---------------- modals ----------------
  function renderBlessing() {
    const st = app.state;
    const clan = st.clans[st.playerClan];
    const pb = clan.pendingBlessing;
    const sig = pb ? pb.choices.join(',') : '';
    if (sig === blessingSig) return;
    blessingSig = sig;
    if (!pb) { nodes.blessingModal.classList.remove('show'); return; }
    nodes.blessingChoices.innerHTML = pb.choices.map((id) => `
      <button class="choice" data-bless="${id}">
        <div class="t">${BLESSINGS[id].icon} ${BLESSINGS[id].name}</div>
        <div class="d">${BLESSINGS[id].desc}</div>
      </button>`).join('');
    nodes.blessingChoices.querySelectorAll('[data-bless]').forEach((el) => {
      el.onclick = () => { E.grantBlessing(st, clan, el.dataset.bless); renderBlessing(); };
    });
    nodes.blessingModal.classList.add('show');
  }

  function renderGameOver() {
    const st = app.state;
    const sig = st.time.ended ? `${st.winner}|${st.condition}` : '';
    if (sig === overSig) return;
    overSig = sig;
    if (!st.time.ended) { nodes.gameOver.classList.remove('show'); return; }
    const won = st.winner === st.playerClan;
    const condText = {
      fame: 'reached legendary fame',
      trade: 'out-traded every rival',
      domination: 'burned the rival Town Hall to the ground',
      time: 'held the most fame when the saga ended',
    }[st.condition] || 'won';
    nodes.goTitle.textContent = won ? '⚔️ Victory' : '💀 Defeat';
    nodes.goText.textContent = won
      ? `${st.clans[st.winner].name} ${condText}. The skalds will sing of this.`
      : `${st.clans[st.winner].name} ${condText}. Your hall falls silent.`;
    const clan = st.clans[st.playerClan];
    nodes.goStats.innerHTML = `
      <div><span>Fame</span><span>${Math.round(clan.fame)}</span></div>
      <div><span>Krowns earned</span><span>${Math.round(clan.totalKrowns)}</span></div>
      <div><span>Land held</span><span>${st.tiles.filter((t) => t.owner === clan.id).length} tiles</span></div>
      <div><span>Battle kills</span><span>${st.stats.kills}</span></div>
      <div><span>Losses</span><span>${st.stats.losses}</span></div>
      <div><span>Buildings raised</span><span>${st.stats.built}</span></div>`;
    nodes.gameOver.classList.add('show');
  }

  return {
    buildStartScreen, buildChips, updateStats, updateSeason,
    update() {
      const st = app.state;
      if (!st) return;
      updateStats();
      updateSeason();
      const ps = panelSignature();
      if (ps !== panelSig) { panelSig = ps; renderPanel(); }
      const cs = `${app.ui.mode}:${app.ui.buildType}:${Math.round(st.clans[st.playerClan].res.wood)}:${Math.round(st.clans[st.playerClan].res.stone)}:${Math.round(st.clans[st.playerClan].res.krown)}:${st.time.ended}`;
      if (cs !== catalogSig) { catalogSig = cs; renderCatalog(); }
      const os = `${app.ui.mode}:${app.ui.selectedUnits.size}:${st.time.paused}:${st.clans[st.playerClan].res.food > 60}:${E.countBuilding(st, st.playerClan, 'barracks')}:${E.countBuilding(st, st.playerClan, 'forge')}:${st.time.ended}`;
      if (os !== ordersSig) { ordersSig = os; renderOrders(); }
      renderToasts();
      renderLog();
      renderBlessing();
      renderGameOver();
    },
    resetSignatures() {
      panelSig = catalogSig = ordersSig = toastSig = logSig = blessingSig = overSig = '';
    },
    showHelp(show = true) { nodes.help.classList.toggle('show', show); },
    hideModals() {
      nodes.help.classList.remove('show');
    },
  };
}
