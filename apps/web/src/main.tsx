import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './app/router';
import { Providers } from './app/providers';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root was not found');

createRoot(root).render(
  <StrictMode>
    <Providers><RouterProvider router={router} /></Providers>
  </StrictMode>,
);
