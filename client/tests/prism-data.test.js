import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accountView, actionView, subscriptionView } from '../src/features/workspace/prism-data.js'

test('Prism live subscription amounts preserve minor units, currency and unknowns', () => {
  assert.equal(subscriptionView({ amountMinor:990, currency:'JPY' }).cost, 990)
  assert.equal(subscriptionView({ amountMinor:999, currency:'USD' }).cost, 9.99)
  assert.equal(subscriptionView({ amountMinor:null, currency:'USD' }).cost, null)
  assert.equal(subscriptionView({ amountMinor:999, currency:null }).cost, null)
  const yearly=subscriptionView({ id:'owned',amountMinor:12000,currency:'EUR',billingCycle:'YEARLY',renewalIsEstimated:true })
  assert.equal(yearly.cost,120)
  assert.equal(yearly.plan,'Yearly')
  assert.equal(yearly.renewalIsEstimated,true)
})
test('Prism account view keeps actual evidence and unknown billing, risk and review state', () => {
  const raw={id:'owned',serviceName:'Service',evidenceCount:5,confidenceLevel:'POSSIBLE',dormantStatus:'POSSIBLY_DORMANT'}
  const evidence=[{id:'signal',evidenceClass:'ACCOUNT_WELCOME',sourceDomain:'example.test'}]
  const view=accountView(raw,{evidence,evidenceTotal:105,evidenceTruncated:true})
  assert.equal(view.signals,5)
  assert.equal(view.confidence,'Possible')
  assert.equal(view.status,'Possibly dormant')
  assert.equal(view.cost,null)
  assert.equal(view.risk,null)
  assert.equal(view.reviewed,false)
  assert.deepEqual(view.evidence,evidence)
  assert.equal(view.evidenceTruncated,true)
})
test('Prism recommendations map actual status without constructing checklist or decisions', () => {
  for(const [status,state] of Object.entries({OPEN:'To do',IN_PROGRESS:'In progress',COMPLETED:'Done',DISMISSED:'Dismissed'})) {
    const view=actionView({id:'owned',status,priority:'HIGH',type:'REVIEW_ACCOUNT'})
    assert.equal(view.state,state)
    assert.equal(view.priority,'High')
    assert.equal(view.steps,undefined)
    assert.equal(view.decision,undefined)
  }
})
