import request from 'supertest'
import {describe,it,expect} from 'vitest'
import app from '../src/app.js'
import User from '../src/models/user.model.js'
describe('persistent private workspace profile',()=>{
  it('requires a session',async()=>{await request(app).patch('/api/auth/profile').send({name:'Other'}).expect(401)})
  it('persists only the authenticated profile and rejects privileged/unknown inputs',async()=>{
    const agent=request.agent(app)
    const registered=await agent.post('/api/auth/register').send({name:'Original',email:'profile@example.test',password:'long-enough-password'}).expect(201)
    const other=await User.create({name:'Other',email:'other@example.test',passwordHash:'unused'})
    const updated=await agent.patch('/api/auth/profile').send({name:' New Name ',workspaceGoal:'Reduce recurring costs'}).expect(200)
    expect(updated.body.user).toMatchObject({id:registered.body.user.id,name:'New Name',workspaceGoal:'Reduce recurring costs'})
    expect(updated.body.user).not.toHaveProperty('passwordHash')
    expect((await User.findById(other.id)).name).toBe('Other')
    for(const body of [{onboardingStatus:'COMPLETED'},{userId:other.id,name:'Attacker'},{name:'x'},{workspaceGoal:'anything'},{},[]])await agent.patch('/api/auth/profile').send(body).expect(400)
    expect((await agent.get('/api/auth/session').expect(200)).body.user.workspaceGoal).toBe('Reduce recurring costs')
  })
})
