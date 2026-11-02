import axios from "axios";

// a local helper that happens to share the vulnerable function's name
function formToJSON(x: unknown) {
  return JSON.stringify(x);
}

export async function GET() {
  const res = await axios.get("https://example.com");
  return Response.json(formToJSON(res.data));
}
