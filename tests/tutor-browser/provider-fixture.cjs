// Loaded only by the dedicated local browser contract test's Next.js process.
const original = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (new URL(url, "http://localhost").hostname !== "api.anthropic.com") return original(input, options);
  if (url !== "https://api.anthropic.com/v1/messages") throw Error("Unexpected provider endpoint");
  const payload = JSON.parse(options.body);
  if (payload.model !== "browser-fixture" || !payload.messages[0].content.includes("Pointers in C")) {
    throw Error("Unexpected tutor request");
  }
  return Response.json({model:"browser-fixture",stop_reason:"end_turn",
    content:[{type:"text",text:"Fixture explanation of pointers."}],usage:{input_tokens:75,output_tokens:100}});
};
