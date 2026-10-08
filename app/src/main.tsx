import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Root } from './App.tsx'
import './index.css'

document.title = `مركز تحكم المطور — v${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.0'}`

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
