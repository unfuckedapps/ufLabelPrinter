import type { ReactNode } from "react";
import { createHashRouter, RouterProvider } from "react-router";

import { AppLayout } from "./components/AppLayout";
import { RouteError } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toasts";
import { I18nProvider } from "./i18n";
import { ConfigProvider, useConfig } from "./lib/config";
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
      { path: "printers", element: <PrintersPage /> },
      { path: "paper", element: <PapersPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

/** The language is part of the saved config, so translations sit below the config. */
function Localized({ children }: { children: ReactNode }) {
  const { config } = useConfig();
  return <I18nProvider language={config.language}>{children}</I18nProvider>;
}

export default function App() {
  return (
    <ConfigProvider>
      <Localized>
        <ToastProvider>
          <StatusProvider>
            <DocumentsProvider>
              <RouterProvider router={router} />
            </DocumentsProvider>
          </StatusProvider>
        </ToastProvider>
      </Localized>
    </ConfigProvider>
  );
}
