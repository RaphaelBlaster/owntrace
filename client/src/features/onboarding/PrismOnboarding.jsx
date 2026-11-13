import {useState} from 'react'
import Setup from '../../demo/Setup.jsx'
import useAuth from '../auth/useAuth.js'
import api from '../../services/api.js'
import '../auth/prism-auth.css'
function PrismOnboarding(){
 const {user,restoreSession}=useAuth()
 const [profile,setProfile]=useState({name:user.name,goal:user.workspaceGoal || 'Get organized'})
 async function completeSetup(values){
  await api.patch('/auth/profile',values)
  let status=user.onboardingStatus
  if(status==='NOT_STARTED'){await api.patch('/onboarding',{status:'PRIVACY_REVIEWED'});status='PRIVACY_REVIEWED'}
  if(status==='PRIVACY_REVIEWED'){await api.patch('/onboarding',{status:'GMAIL_PENDING'});status='GMAIL_PENDING'}
  if(status!=='COMPLETED')await api.patch('/onboarding',{status:'COMPLETED'})
  await restoreSession({showLoading:false})
 }
 return <div className="dx-design-scope prism-auth-flow" data-design="prism"><Setup liveSetup={{profile,setProfile,providers:{},scanning:false,completeSetup,setToast:()=>{}}}/></div>
}
export default PrismOnboarding
