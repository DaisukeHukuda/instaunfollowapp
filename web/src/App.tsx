import { useState } from 'react';
import ListView from './ListView';

type View = 'list' | 'import';

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
          <button className={view === 'import' ? 'active' : ''} onClick={() => setView('import')}>
            取り込み
          </button>
        </nav>
      </header>
      <main>{view === 'list' ? <ListView /> : <p>取り込み（Task 8 で実装）</p>}</main>
    </div>
  );
}
