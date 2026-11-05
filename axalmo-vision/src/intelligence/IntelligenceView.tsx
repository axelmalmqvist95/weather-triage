import { useCallback, useEffect, useMemo, useState } from 'react';
import { openStore, requestPersistence, type OntologyStore } from '../ontology/store.ts';
import { Ontology } from '../ontology/actions.ts';
import { seedSyntheticData } from '../ontology/seed.ts';
import { countByKind, filterEvents } from '../ontology/search.ts';
import { buildGraph, neighbours, type GraphNode } from '../ontology/graph.ts';
import {
  EVENT_KINDS, SEVERITY_LABEL,
  type EventKind, type Observation, type OntologyEvent, type Property, type Space, type SubjectType,
} from '../ontology/schema.ts';
import './intelligence.css';

interface Data { properties: Property[]; spaces: Space[]; observations: Observation[]; events: OntologyEvent[] }
const EMPTY: Data = { properties: [], spaces: [], observations: [], events: [] };
type Tab = 'logg' | 'graf';

const KIND_COLOR: Record<EventKind, string> = {
  skapad: '#00e5ff', uppdaterad: '#7d97a3', 'status-ändrad': '#b6ff3d', inspektion: '#ffd23d', 'ai-förslag': '#c9b6ff', kommentar: '#ff9f1c',
};
const SEV_COLOR = { 1: '#7d97a3', 2: '#ffd23d', 3: '#ff9f1c', 4: '#ff4d6d' } as const;
const SUBJECT_LABEL: Record<SubjectType, string> = { property: 'Fastighet', space: 'Yta', observation: 'Observation' };

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function IntelligenceView() {
  const [store, setStore] = useState<OntologyStore | null>(null);
  const [data, setData] = useState<Data>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('logg');
  const [text, setText] = useState('');
  const [kinds, setKinds] = useState<EventKind[]>([]);
  const [subjects, setSubjects] = useState<SubjectType[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const reload = useCallback(async (s: OntologyStore) => {
    const [properties, spaces, observations, events] = await Promise.all([s.all('property'), s.all('space'), s.all('observation'), s.events()]);
    setData({ properties, spaces, observations, events });
  }, []);

  useEffect(() => {
    let s: OntologyStore | null = null;
    openStore()
      .then(async (st) => {
        s = st;
        setStore(st);
        await reload(st);
        setPersisted(await requestPersistence());
      })
      .catch((e) => setError(`Kunde inte öppna lokal databas: ${(e as Error).message}`));
    return () => s?.close();
  }, [reload]);

  const run = async (fn: (s: OntologyStore) => Promise<void>) => {
    if (!store) return;
    setBusy(true);
    setError(null);
    try {
      await fn(store);
      await reload(store);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const seed = () => run((s) => seedSyntheticData(new Ontology(s)).then(() => undefined));
  const clearAll = () => {
    if (!confirm('Radera all Intelligence-data i den här telefonen?')) return;
    setSelected(null);
    run((s) => s.clear());
  };
  const exportJson = () =>
    run(async (s) => {
      const dump = await s.exportDump();
      const name = `axalmo-intelligence-${dump.exportedAt.slice(0, 10)}.json`;
      const file = new File([JSON.stringify(dump, null, 2)], name, { type: 'application/json' });
      try {
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Axalmo Intelligence' });
          return;
        }
      } catch {
        /* avbrutet – ladda ner i stället */
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });

  // Etiketter för sökning och visning
  const labels = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of data.properties) m.set(p.id, p.name);
    for (const s of data.spaces) m.set(s.id, s.name);
    for (const o of data.observations) m.set(o.id, o.title);
    return m;
  }, [data]);

  const filtered = useMemo(
    () => filterEvents(data.events, { text, kinds, subjectTypes: subjects, propertyId: propertyId || undefined }, labels),
    [data.events, text, kinds, subjects, propertyId, labels],
  );
  const kindCounts = useMemo(() => countByKind(data.events), [data.events]);

  const graphProp = propertyId || data.properties[0]?.id || '';
  const graph = useMemo(() => buildGraph(data, graphProp), [data, graphProp]);
  const highlight = selected ? neighbours(graph, selected) : null;

  const openCount = data.observations.filter((o) => o.status === 'öppen' || o.status === 'bekräftad').length;
  const critical = data.observations.filter((o) => o.severity === 4 && o.status !== 'åtgärdad' && o.status !== 'avvisad').length;

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const select = (id: string) => setSelected((cur) => (cur === id ? null : id));
  const showInGraph = (id: string) => {
    const pid = data.properties.find((p) => p.id === id)?.id ?? data.spaces.find((s) => s.id === id)?.propertyId ?? data.observations.find((o) => o.id === id)?.propertyId;
    if (pid) setPropertyId(pid);
    setSelected(id);
    setTab('graf');
  };

  return (
    <div className="intel">
      <header className="intel-top">
        <a className="intel-back" href="#/">‹ Vision</a>
        <div className="intel-brand">AXALMO<span>INTELLIGENCE</span></div>
        <span className="intel-chip">v0.1 · lokal</span>
      </header>

      <main className="intel-main">
        <section className="intel-stats">
          <Stat n={data.properties.length} label="fastigheter" />
          <Stat n={data.spaces.length} label="ytor" />
          <Stat n={openCount} label="aktiva obs." />
          <Stat n={critical} label="kritiska" danger={critical > 0} />
          <Stat n={data.events.length} label="händelser" />
        </section>

        {error && <div className="intel-error" role="alert">{error}</div>}

        {data.properties.length === 0 ? (
          <section className="intel-empty">
            <p>Ingen data ännu. Ladda syntetisk testdata (påhittade fastigheter) för att utforska händelseloggen och relationsgrafen.</p>
            <button className="intel-btn primary" disabled={!store || busy} onClick={seed}>
              {busy ? 'Skapar…' : 'Ladda syntetisk testdata'}
            </button>
          </section>
        ) : (
          <>
            <nav className="intel-tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'logg'} className={tab === 'logg' ? 'sel' : ''} onClick={() => setTab('logg')}>Händelselogg</button>
              <button role="tab" aria-selected={tab === 'graf'} className={tab === 'graf' ? 'sel' : ''} onClick={() => setTab('graf')}>Relationsgraf</button>
            </nav>

            <div className="intel-filters">
              <select value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setSelected(null); }} aria-label="Fastighet">
                {tab === 'logg' && <option value="">Alla fastigheter</option>}
                {data.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {tab === 'logg' && (
                <>
                  <input type="search" placeholder="Sök, t.ex. mögel källare" value={text} onChange={(e) => setText(e.target.value)} aria-label="Sök i händelseloggen" />
                  <div className="intel-chips">
                    {EVENT_KINDS.filter((k) => kindCounts[k]).map((k) => (
                      <button key={k} className={kinds.includes(k) ? 'sel' : ''} style={{ ['--c' as string]: KIND_COLOR[k] }} onClick={() => setKinds(toggle(kinds, k))}>
                        {k} <small>{kindCounts[k]}</small>
                      </button>
                    ))}
                  </div>
                  <div className="intel-chips">
                    {(Object.keys(SUBJECT_LABEL) as SubjectType[]).map((s) => (
                      <button key={s} className={subjects.includes(s) ? 'sel' : ''} onClick={() => setSubjects(toggle(subjects, s))}>{SUBJECT_LABEL[s]}</button>
                    ))}
                    {(kinds.length > 0 || subjects.length > 0 || text) && (
                      <button className="clear" onClick={() => { setKinds([]); setSubjects([]); setText(''); }}>Rensa filter</button>
                    )}
                  </div>
                </>
              )}
            </div>

            {tab === 'logg' ? (
              <section>
                <p className="intel-muted">{filtered.length} av {data.events.length} händelser</p>
                <ul className="intel-log">
                  {filtered.slice(0, 200).map((e) => (
                    <li key={e.id} className={selected === e.subjectId ? 'sel' : ''} onClick={() => select(e.subjectId)}>
                      <div className="row1">
                        <span className="kind" style={{ color: KIND_COLOR[e.kind], borderColor: KIND_COLOR[e.kind] }}>{e.kind}</span>
                        <time dateTime={e.at}>{fmt(e.at)}</time>
                      </div>
                      <div className="sum">{e.summary}</div>
                      <div className="meta">{SUBJECT_LABEL[e.subjectType]} · {labels.get(e.subjectId) ?? '–'} · {labels.get(e.propertyId) ?? ''} · {e.actor}</div>
                    </li>
                  ))}
                </ul>
                {filtered.length > 200 && <p className="intel-muted">Visar de 200 senaste. Förfina sökningen.</p>}
              </section>
            ) : (
              <section className="intel-graph">
                <svg viewBox={`${graph.bounds.minX} ${graph.bounds.minY} ${graph.bounds.width} ${graph.bounds.height}`} role="img" aria-label="Relationsgraf">
                  {graph.edges.map((e) => {
                    const a = graph.nodes.find((n) => n.id === e.from), b = graph.nodes.find((n) => n.id === e.to);
                    if (!a || !b) return null;
                    const dim = highlight && !(highlight.has(a.id) && highlight.has(b.id));
                    return <line key={`${e.from}-${e.to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`edge ${e.type}`} opacity={dim ? 0.12 : 0.7} />;
                  })}
                  {graph.nodes.map((n) => (
                    <Node key={n.id} n={n} dim={!!highlight && !highlight.has(n.id)} selected={selected === n.id} onClick={() => select(n.id)} />
                  ))}
                </svg>
                <div className="intel-legend">
                  <span><i className="dot prop" />Fastighet</span>
                  <span><i className="dot space" />Yta</span>
                  {([1, 2, 3, 4] as const).map((s) => <span key={s}><i className="dot" style={{ background: SEV_COLOR[s] }} />{SEVERITY_LABEL[s]}</span>)}
                  <span><i className="dash" />del av</span>
                </div>
              </section>
            )}

            {selected && <Detail id={selected} data={data} labels={labels} onClose={() => setSelected(null)} onGraph={tab === 'logg' ? () => showInGraph(selected) : undefined} />}

            <footer className="intel-actions">
              <button className="intel-btn" disabled={busy} onClick={exportJson}>Exportera JSON</button>
              <button className="intel-btn" disabled={busy} onClick={seed}>+ Mer testdata</button>
              <button className="intel-btn danger" disabled={busy} onClick={clearAll}>Rensa data</button>
            </footer>
          </>
        )}
        <p className="intel-muted small">
          All data lagras endast i den här enheten (IndexedDB). Beständig lagring: {persisted === null ? 'okänt' : persisted ? 'ja' : 'nej – webbläsaren kan rensa vid lågt utrymme'}.
          Ingen persondata eller identifiering av personer.
        </p>
      </main>
    </div>
  );
}

function Stat({ n, label, danger }: { n: number; label: string; danger?: boolean }) {
  return (
    <div className={`intel-stat ${danger ? 'danger' : ''}`}>
      <b>{n}</b>
      <span>{label}</span>
    </div>
  );
}

function Node({ n, dim, selected, onClick }: { n: GraphNode; dim: boolean; selected: boolean; onClick: () => void }) {
  const fill = n.type === 'property' ? '#00e5ff' : n.type === 'space' ? '#0b2a33' : SEV_COLOR[n.severity ?? 1];
  const done = n.status === 'åtgärdad' || n.status === 'avvisad';
  return (
    <g className={`node ${n.type}`} opacity={dim ? 0.2 : done ? 0.55 : 1} onClick={onClick} style={{ cursor: 'pointer' }}>
      <circle cx={n.x} cy={n.y} r={n.r + 14} fill="transparent" />
      <circle cx={n.x} cy={n.y} r={n.r} fill={fill} stroke={selected ? '#ffffff' : n.type === 'space' ? '#00e5ff' : 'none'} strokeWidth={selected ? 3 : 2} />
      {n.status === 'åtgärdad' && <text x={n.x} y={n.y + 4} textAnchor="middle" className="check">✓</text>}
      {n.type !== 'observation' && (
        <text x={n.x} y={n.y + n.r + 16} textAnchor="middle" className="label">{n.label.length > 18 ? n.label.slice(0, 17) + '…' : n.label}</text>
      )}
    </g>
  );
}

function Detail({ id, data, labels, onClose, onGraph }: { id: string; data: Data; labels: Map<string, string>; onClose: () => void; onGraph?: () => void }) {
  const p = data.properties.find((x) => x.id === id);
  const s = data.spaces.find((x) => x.id === id);
  const o = data.observations.find((x) => x.id === id);
  const events = filterEvents(data.events, { subjectId: id });
  const rows: [string, string][] = p
    ? [['Typ', 'Fastighet'], ['Adress', p.address], ['Kommun', p.municipality ?? '–'], ['Byggår', String(p.buildYear ?? '–')],
       ['Ytor', String(data.spaces.filter((x) => x.propertyId === p.id).length)], ['Observationer', String(data.observations.filter((x) => x.propertyId === p.id).length)]]
    : s
      ? [['Typ', `Yta (${s.kind})`], ['Fastighet', labels.get(s.propertyId) ?? '–'], ['Del av', s.parentSpaceId ? labels.get(s.parentSpaceId) ?? '–' : '–'],
         ['Plan', String(s.floor ?? '–')], ['Yta', s.areaM2 ? `${s.areaM2} m²` : '–'], ['Observationer', String(data.observations.filter((x) => x.spaceId === s.id).length)]]
      : o
        ? [['Typ', `Observation (${o.category})`], ['Yta', labels.get(o.spaceId) ?? '–'], ['Allvarlighet', `${o.severity} – ${SEVERITY_LABEL[o.severity]}`],
           ['Status', o.status], ['Källa', o.source + (o.confidence !== undefined ? ` (${Math.round(o.confidence * 100)} %)` : '')], ['Observerad', fmt(o.observedAt)], ...(o.note ? [['Anteckning', o.note] as [string, string]] : [])]
        : [];
  return (
    <section className="intel-detail">
      <div className="head">
        <b>{p?.name ?? s?.name ?? o?.title ?? id}</b>
        <button onClick={onClose} aria-label="Stäng">✕</button>
      </div>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      <h4>Händelser ({events.length})</h4>
      <ul>
        {events.map((e) => <li key={e.id}><time>{fmt(e.at)}</time> {e.summary}</li>)}
      </ul>
      {onGraph && <button className="intel-btn" onClick={onGraph}>Visa i relationsgraf</button>}
    </section>
  );
}
