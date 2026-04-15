import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ThemeProvider } from './context/ThemeContext'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      notifyOnChangeProps: ['data', 'error'],
      // The app already uses explicit polling where live freshness matters.
      // Disabling focus refetch avoids native <select> popups collapsing on
      // Windows/Chromium when the browser briefly blurs/refocuses the page.
      refetchOnWindowFocus: false,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </QueryClientProvider>
  </ThemeProvider>,
)
