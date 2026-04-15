import React, { createContext, useContext, useEffect, useState } from 'react'

export type Theme = 'midnight' | 'obsidian' | 'dusk' | 'light'

export const THEMES: { value: Theme; label: string; preview: string }[] = [
  { value: 'midnight', label: 'Midnight',  preview: '#030712' },
  { value: 'obsidian', label: 'Obsidian',  preview: '#000000' },
  { value: 'dusk',     label: 'Dusk',      preview: '#0c0a06' },
  { value: 'light',    label: 'Light',     preview: '#f8fafc' },
]

const STORAGE_KEY = 'ut_theme'

interface ThemeContextValue {
  theme: Theme
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'midnight',
  setTheme: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
    return stored && THEMES.some((t) => t.value === stored) ? stored : 'midnight'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  // Apply on mount without flash
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeState }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
