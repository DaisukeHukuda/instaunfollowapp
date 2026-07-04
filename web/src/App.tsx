import { useState } from 'react';
import ImportView from './ImportView';
import ListView from './ListView';
import QueueView from './QueueView';

type View = 'list' | 'queue' | 'import';

export default function App() {
  const [view, setView] = useState<View>('list');
  return (
    <div className="app">
      <header className="app-header">
        <h1>Instagram フォロー整理</h1>
        <nav>
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            一覧
          </button>
          <button className={view === 'queue' ? 'active' : ''} onClick={() => setView('queue')}>
            キュー
          </button>
          <button className={view === 'import' ? 'active' : ''} onClick={() => setView('import')}>
            取り込み
          </button>
        </nav>
      </header>
      <main>
        {view === 'list' && <ListView />}
        {view === 'queue' && <QueueView />}
        {view === 'import' && <ImportView />}
      </main>
    </div>
  );
}
