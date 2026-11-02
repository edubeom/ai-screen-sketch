import { useState } from 'react';
import { TopBar } from './TopBar.tsx';
import { LeftPanel } from './LeftPanel.tsx';
import { Canvas } from './Canvas.tsx';
import { Inspector } from './Inspector.tsx';
import { IssuesPanel } from './IssuesPanel.tsx';
import { ExportDialog, ImportDialog, ProjectsDialog } from './Dialogs.tsx';
import { useEditor } from './store.ts';
import { ColorPopup } from './ColorPopup.tsx';
import { PenButtonsDialog } from './PenButtonsDialog.tsx';

type DialogKind = 'projects' | 'export' | 'import' | 'pen' | undefined;

export function App() {
  const [dialog, setDialog] = useState<DialogKind>();
  const toast = useEditor((s) => s.toast);
  const saveError = useEditor((s) => s.saveError);
  return (
    <div className="app">
      <TopBar onProjects={() => setDialog('projects')} onExport={() => setDialog('export')} onImport={() => setDialog('import')} />
      {saveError && <div className="save-error" role="alert">{saveError}</div>}
      <div className="main">
        <LeftPanel />
        <Canvas onPenButtons={() => setDialog('pen')} />
        <Inspector />
      </div>
      <IssuesPanel />
      {dialog === 'projects' && <ProjectsDialog onClose={() => setDialog(undefined)} />}
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(undefined)} />}
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(undefined)} />}
      {dialog === 'pen' && <PenButtonsDialog onClose={() => setDialog(undefined)} />}
      <ColorPopup />
      {toast && <div className={`toast ${toast.kind}`} role="status" data-testid="toast">{toast.text}</div>}
    </div>
  );
}
