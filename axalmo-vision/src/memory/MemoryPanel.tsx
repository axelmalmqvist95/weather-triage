import { useMemo, useState } from 'react';
import { recall, itemHistory, placeWithChildren, type MemoryData } from './recall.ts';
import { compareObservations, CompareError } from './compare.ts';
import { workspaceKind, type Observation } from '../ontology/schema.ts';

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

const sourceLabel = (o: Observation) =>
  o.source === 'kamera' ? `kamera ${Math.round((o.confidence ?? 0) * 100)} %` : o.source === 'ai-förslag' ? `AI-förslag ${Math.round((o.confidence ?? 0) * 100)} %` : o.source;

/** RECALL + historik + COMPARE. Läser bara – alla ändringar sker via actions på andra ställen. */
export default function MemoryPanel({ data, labels }: { data: MemoryData; labels: Map<string, string> }) {
  const [text, setText] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [spaceId, setSpaceId] = useState('');
  const [itemId, setItemId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  const spaces = data.spaces.filter((s) => !workspaceId || s.propertyId === workspaceId);
  const items = data.items.filter((i) => (!workspaceId || i.propertyId === workspaceId) && (!spaceId || (i.spaceId && placeWithChildren(data.spaces, spaceId).has(i.spaceId))));

  const results = useMemo(
    () => recall(data, {
      text, workspaceId: workspaceId || undefined, spaceId: spaceId || undefined, itemId: itemId || undefined,
      from: from ? `${from}T00:00:00.000Z` : undefined, to: to ? `${to}T23:59:59.999Z` : undefined,
    }),
    [data, text, workspaceId, spaceId, itemId, from, to],
  );

  const history = openItem ? itemHistory(data, openItem) : null;
  const comparison = useMemo(() => {
    if (picked.length !== 2) return null;
    const [a, b] = picked.map((id) => data.observations.find((o) => o.id === id)!);
    try {
      return compareObservations(a, b, labels);
    } catch (e) {
      return e instanceof CompareError ? e : null;
    }
  }, [picked, data.observations, labels]);

  const togglePick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]));
  const filtersActive = text || workspaceId || spaceId || itemId || from || to;

  if (data.observations.filter((o) => o.itemId).length === 0) {
    return (
      <section className="mem-empty">
        <p>Inga minnen ännu.</p>
        <p className="intel-muted">I Vision: starta kameran och <b>tryck på ett föremål</b> i bilden. Granska förslaget och tryck <b>Spara i minnet</b>.</p>
        <a className="intel-btn primary" href="#/">Till Vision</a>
      </section>
    );
  }

  return (
    <section className="mem">
      <div className="intel-filters">
        <input type="search" placeholder="Sök i minnet, t.ex. laptop repa" value={text} onChange={(e) => setText(e.target.value)} aria-label="Sök i minnet" />
        <div className="mem-grid">
          <select value={workspaceId} onChange={(e) => { setWorkspaceId(e.target.value); setSpaceId(''); setItemId(''); }} aria-label="Arbetsyta">
            <option value="">Alla arbetsytor</option>
            {data.properties.map((p) => <option key={p.id} value={p.id}>{p.name} ({workspaceKind(p)})</option>)}
          </select>
          <select value={spaceId} onChange={(e) => { setSpaceId(e.target.value); setItemId(''); }} aria-label="Plats">
            <option value="">Alla platser</option>
            {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={itemId} onChange={(e) => setItemId(e.target.value)} aria-label="Föremål">
            <option value="">Alla föremål</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <label className="mem-date">Från<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="mem-date">Till<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        {filtersActive && (
          <div className="intel-chips">
            <button className="clear" onClick={() => { setText(''); setWorkspaceId(''); setSpaceId(''); setItemId(''); setFrom(''); setTo(''); }}>Rensa filter</button>
          </div>
        )}
      </div>

      <p className="intel-muted">{results.length} godkända observationer</p>
      <ul className="mem-list">
        {results.slice(0, 200).map((o) => {
          const item = o.itemId ? data.items.find((i) => i.id === o.itemId) : undefined;
          return (
            <li key={o.id} className={openItem && o.itemId === openItem ? 'sel' : ''} onClick={() => { if (o.itemId) { setOpenItem(o.itemId); setPicked([]); } }}>
              <div className="row1">
                <b>{item?.name ?? labels.get(o.spaceId ?? '') ?? '–'}</b>
                <time dateTime={o.observedAt}>{fmt(o.observedAt)}</time>
              </div>
              <div>{o.title}{o.note ? ` – ${o.note}` : ''}</div>
              <div className="meta">
                {labels.get(o.propertyId)} · {o.spaceId ? labels.get(o.spaceId) : 'ingen plats'} · <span className="src">{sourceLabel(o)}</span>
              </div>
            </li>
          );
        })}
      </ul>

      {history && (
        <section className="intel-detail mem-history">
          <div className="head">
            <b>{history.item.name}</b>
            <button onClick={() => { setOpenItem(null); setPicked([]); }} aria-label="Stäng">✕</button>
          </div>
          <dl>
            <div><dt>Kategori</dt><dd>{history.item.category}</dd></div>
            <div><dt>Status</dt><dd>{history.item.status}</dd></div>
            <div><dt>Arbetsyta</dt><dd>{labels.get(history.item.propertyId)}</dd></div>
            <div><dt>Plats nu</dt><dd>{history.item.spaceId ? labels.get(history.item.spaceId) : '–'}</dd></div>
            {(history.item.brand || history.item.model) && <div><dt>Märke/modell</dt><dd>{[history.item.brand, history.item.model].filter(Boolean).join(' ')}</dd></div>}
          </dl>

          <h4>Relationer</h4>
          <ul>
            {history.relations.length === 0 && <li className="intel-muted">Inga</li>}
            {history.relations.map((r, i) => (
              <li key={i}>{r.direction === 'ut' ? `${r.kind} → ${labels.get(r.otherId) ?? r.otherId}` : `${labels.get(r.otherId) ?? r.otherId} → ${r.kind}`}</li>
            ))}
          </ul>

          <h4>Observationer ({history.observations.length}) – välj två för att jämföra</h4>
          <ul className="mem-obs">
            {history.observations.map((o) => (
              <li key={o.id}>
                <label>
                  <input type="checkbox" checked={picked.includes(o.id)} onChange={() => togglePick(o.id)} />
                  <span><time>{fmt(o.observedAt)}</time> {o.title} · {o.status} · {o.spaceId ? labels.get(o.spaceId) : 'ingen plats'} · {sourceLabel(o)}</span>
                </label>
              </li>
            ))}
          </ul>

          {comparison instanceof CompareError && <p className="intel-error">{comparison.message}</p>}
          {comparison && !(comparison instanceof CompareError) && (
            <div className="mem-compare">
              <h4>Jämförelse · {comparison.days} dagar emellan</h4>
              {comparison.changes.length === 0 ? (
                <p className="intel-muted">Inga skillnader i registrerade uppgifter.</p>
              ) : (
                <table>
                  <thead><tr><th>Fält</th><th>{fmt(comparison.older.observedAt)}</th><th>{fmt(comparison.newer.observedAt)}</th></tr></thead>
                  <tbody>
                    {comparison.changes.map((c) => (
                      <tr key={c.field}><td>{c.label}</td><td className="before">{c.before}</td><td className="after">{c.after}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="intel-muted">Oförändrat: {comparison.unchanged.join(', ') || '–'}</p>
              {comparison.notes.map((n) => <p key={n} className="mem-note">ⓘ {n}</p>)}
            </div>
          )}

          <h4>Händelser</h4>
          <ul>
            {history.events.map((e) => <li key={e.id}><time>{fmt(e.at)}</time> {e.summary}</li>)}
          </ul>
        </section>
      )}
    </section>
  );
}
