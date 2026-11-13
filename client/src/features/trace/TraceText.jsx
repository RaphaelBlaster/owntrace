// Format the model's inline emphasis as React text nodes, never injected HTML.
function TraceText({ content }) {
  return String(content).split(/\*\*([^*]+)\*\*/g).map((part,index)=>index % 2 ? <strong key={index}>{part}</strong> : part)
}
export default TraceText
