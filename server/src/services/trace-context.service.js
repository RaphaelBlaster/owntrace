const toolFamilies = {
  query_accounts: ['accounts'], get_account: ['accounts'], open_account: ['accounts'],
  query_subscriptions: ['subscriptions'], show_subscriptions: ['subscriptions'],
  query_orders: ['orders'], get_order: ['orders'], open_order: ['orders'],
  query_mail_insights: ['mailInsights'], privacy_overview: [], workspace_status: ['status'],
}
const allowedViews=new Set(['dashboard','accounts','subscriptions','orders','top-k','privacy-inbox','account-actions','privacy-health','breaches','exposures','connect','settings','account','subscription','order','closed'])

function traceReferenceContext(history) {
  const recentWorkspaceContext=history.filter(message=>message.role==='assistant' && message.status==='completed').slice(-6).flatMap(message=>{
    const families=new Set()
    for (const item of message.grounding || []) {
      for (const family of toolFamilies[item.tool] || []) families.add(family)
      if (item.tool==='retrieval_plan') for (const family of item.query?.requiredFamilies || []) families.add(family)
    }
    const views=[...new Set((message.actions||[]).map(action=>action.type==='show_subscriptions'?'subscriptions':action.type==='open_account'?'account':action.type==='open_order'?'order':action.type==='show_mail_insights'?'top-k':action.type==='close_preview'?'closed':action.type==='focus_entity'?action.entityType:action.type==='navigate_to_page'?action.page:null).filter(view=>allowedViews.has(view))) ]
    // Exact mail filters shown last, so the model can reopen "this"/"it" however the user phrases it.
    const mailViews=(message.grounding||[]).filter(item=>item.tool==='query_mail_insights' && item.query).map(({query})=>({category:query.category??'jobs',kind:query.kind??'',status:query.status??'',search:String(query.search??'').slice(0,80)})).slice(0,3)
    return families.size || views.length ? [{recordFamilies:[...families],views,...(mailViews.length?{mailViews}:{})}] : []
  }).slice(-3)
  return {recentUserMessages:history.filter(message=>message.role==='user' && message.status==='completed').slice(-4).map(message=>message.content.slice(0,1000)),recentWorkspaceContext}
}

export { traceReferenceContext }
