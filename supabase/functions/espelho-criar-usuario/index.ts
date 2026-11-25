const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const url = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const json = (status: number, body: object) => Response.json(body, { status, headers: cors });

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return json(405, {});
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json(401, {});
  if (!url || !serviceKey) return json(503, {});
  try {
    const validacao = await fetch(url + "/auth/v1/user", { headers: { apikey: serviceKey, Authorization: authorization } });
    if (!validacao.ok) return json(401, {});
    const { id } = await validacao.json();
    const perfil = await fetch(url + "/rest/v1/espelho_usuarios?select=administrador&id=eq." + encodeURIComponent(id), {
      headers: { apikey: serviceKey, Authorization: authorization },
    });
    if (!perfil.ok || (await perfil.json())[0]?.administrador !== true) return json(403, {});

    const { email, senha } = await request.json();
    if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof senha !== "string" || senha.length < 12 || senha.length > 72) {
      return json(400, { mensagem: "Confira o e-mail e informe uma senha de 12 a 72 caracteres." });
    }

    const headers = { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" };
    const criada = await fetch(url + "/auth/v1/admin/users", {
      method: "POST", headers,
      body: JSON.stringify({ email, password: senha, email_confirm: true }),
    });
    if (!criada.ok) {
      const erro = await criada.json().catch(() => ({}));
      return json(400, { mensagem: erro.error_code === "email_exists" ? "Este e-mail já está cadastrado." : "Não foi possível criar a conta. Confira os dados." });
    }
    const usuario = await criada.json();
    const registro = await fetch(url + "/rest/v1/espelho_usuarios", {
      method: "POST", headers, body: JSON.stringify({ id: usuario.id, email: usuario.email }),
    }).catch(() => undefined);
    if (!registro?.ok) {
      const removida = await fetch(url + "/auth/v1/admin/users/" + encodeURIComponent(usuario.id), { method: "DELETE", headers }).catch(() => undefined);
      return json(502, { mensagem: removida?.ok ? "Não foi possível cadastrar o usuário. Tente novamente." : "A conta foi criada sem acesso. A regularização deve ser feita no Supabase." });
    }
    return json(201, { id: usuario.id });
  } catch {
    return json(502, { mensagem: "Não foi possível concluir a operação." });
  }
});
