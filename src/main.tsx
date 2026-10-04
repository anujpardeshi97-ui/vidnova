/* ============================================================================
 * main.tsx - entry point.
 * Seeds the database before the first render so every screen reads a
 * consistent state on its very first paint.
 * ==========================================================================*/
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { seedDatabase } from './services/db';
import '../index.css';

seedDatabase();

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

createRoot(container).render(
  React.createElement(React.StrictMode, null, React.createElement(App)),
);
