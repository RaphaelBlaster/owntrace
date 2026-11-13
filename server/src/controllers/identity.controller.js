import { getIdentityGraph as getGraphForUser } from '../services/identity-graph.service.js'

async function getIdentityGraph(request, response) {
  const graph = await getGraphForUser(request.auth.userId)
  response.status(200).json({ success: true, graph })
}

export { getIdentityGraph }
