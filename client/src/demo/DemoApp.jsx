import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { DemoContext } from './context.js'
import { initialAccounts, initialActions } from './data.js'
import { Icon } from './components.jsx'
import Setup from './Setup.jsx'
import WorkspaceShell from './WorkspaceShell.jsx'
import './demo.css'
import '@fontsource-variable/manrope'
import './directions.css'
import './polish.css'
import './prism-bits.css'
import './navigation.css'
import { loadWorkspace, saveWorkspace, defaultProfile } from './workspace-storage.js'


export default function DemoApp() {
  const [saved] = useState(loadWorkspace)
  const [actions, setActions] = useState(saved.actions)
  const [accounts, setAccounts] = useState(saved.accounts)
  const [providers, setProviders] = useState(saved.providers)
  const [profile, setProfile] = useState(saved.profile)
  const [modal, setModal] = useState(null)
  const [toast, setToast] = useState('')
  const [scanning, setScanning] = useState(false)
  const [lastScan, setLastScan] = useState(saved.lastScan)
  const [checks, setChecks] = useState(saved.checks)
  useEffect(() => { saveWorkspace({ actions, accounts, providers, profile, lastScan, checks }) }, [actions, accounts, providers, profile, lastScan, checks])
  useEffect(() => { if (!toast) return undefined; const timeout = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timeout) }, [toast])
  useEffect(() => { if (!scanning) return undefined; const timeout = setTimeout(() => { setScanning(false); setLastScan('Just now'); setToast(`Sample scan complete. Your ${accounts.length} example accounts are ready to review.`) }, 1600); return () => clearTimeout(timeout) }, [scanning, accounts.length])
  function resetDemo() { setActions(initialActions.map(action => ({ ...action }))); setAccounts(initialAccounts.map(account => ({ ...account }))); setProviders({ Gmail: true, Outlook: true }); setChecks({}); setProfile({ ...defaultProfile }); setScanning(false); setLastScan('Today, 9:42 AM'); setToast('The sample workspace has been reset.') }
  const value = { actions, setActions, accounts, setAccounts, providers, setProviders, profile, setProfile, modal, setModal, toast, setToast, scanning, setScanning, lastScan, checks, setChecks, resetDemo }
  return <DemoContext.Provider value={value}><div className="dx-design-scope" data-design="prism"><Routes><Route path="start" element={<Setup />} /><Route path="*" element={<WorkspaceShell />} /></Routes>{toast ? <div className="dx-toast" role="status"><Icon name="check" size={20} /><span>{toast}</span><button type="button" aria-label="Dismiss message" onClick={() => setToast('')}><Icon name="close" size={16} /></button></div> : null}</div></DemoContext.Provider>
}
