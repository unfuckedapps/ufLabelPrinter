import { createHashRouter, RouterProvider } from "react-router";

import { AppLayout } from "./components/AppLayout";
import { RouteError } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toasts";
import { ConfigProvider } from "./lib/config";
import { DocumentsProvider } from "./lib/documents";
import { StatusProvider } from "./lib/status";
import { NotFound } from "./pages/NotFound";
import { PapersPage } from "./pages/PapersPage";
import { PrintersPage } from "./pages/PrintersPage";
import { PrintPage } from "./pages/PrintPage";

// Hash routing: the bundled app is served from a custom protocol without SPA fallback.
const router = createHashRouter([
  {
    element: <AppLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <PrintPage /> },
      { path: "drucker", element: <PrintersPage /> },
      { path: "papier", element: <PapersPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

export default function App() {
  return (
    <ToastProvider>
      <ConfigProvider>
        <StatusProvider>
          <DocumentsProvider>
            <RouterProvider router={router} />
          </DocumentsProvider>
        </StatusProvider>
      </ConfigProvider>
    </ToastProvider>
  );
}
