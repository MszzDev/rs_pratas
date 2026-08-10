import { Routes, Route } from "react-router-dom";

function Placeholder() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-rose-primary">RS Pratas</h1>
        <p className="mt-2 text-text-secondary">Fase 1 em desenvolvimento.</p>
      </div>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="*" element={<Placeholder />} />
    </Routes>
  );
}
