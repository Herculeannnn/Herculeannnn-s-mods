(() => {
  const cfg = window.MPC_CONFIG || {};
  const configured = cfg.supabaseUrl && cfg.supabaseAnonKey &&
    !cfg.supabaseUrl.includes("PASTE_") && !cfg.supabaseAnonKey.includes("PASTE_");
  const $ = id => document.getElementById(id);
  const grid = $("pack-grid"), status = $("status");
  let client = null, allPacks = [], category = "All";

  $("year").textContent = new Date().getFullYear();

  function message(text, error=false) {
    $("modal-message").textContent = text;
    $("modal-message").style.color = error ? "#ff9baf" : "#c7a4f1";
  }
  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function dateLabel(value) {
    if (!value) return "Date unavailable";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "Date unavailable" : d.toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"});
  }
  function render() {
    const query = $("search").value.trim().toLowerCase();
    const filtered = allPacks.filter(p =>
      (category === "All" || p.category === category) &&
      [p.name,p.description,p.category,p.version].some(v => String(v || "").toLowerCase().includes(query))
    );
    $("pack-count").textContent = allPacks.length;
    if (!filtered.length) {
      grid.innerHTML = `<div class="empty-state"><p>${allPacks.length ? "No packs match your search." : "The archive is empty for now. Check back soon."}</p></div>`;
      return;
    }
    grid.innerHTML = filtered.map(p => {
      const icon = p.icon_url ? `<img src="${escapeHTML(p.icon_url)}" alt="">` : escapeHTML((p.name || "M").slice(0,1).toUpperCase());
      return `<article class="pack-card">
        <div class="card-top"><div class="pack-icon">${icon}</div><span class="category">${escapeHTML(p.category || "Other")}</span></div>
        <h3>${escapeHTML(p.name)}</h3><div class="version">VERSION ${escapeHTML(p.version)}</div>
        <p class="description">${escapeHTML(p.description || "No description provided.")}</p>
        <div class="card-bottom"><span class="date">${dateLabel(p.created_at)}</span><a class="download" href="${escapeHTML(p.download_url)}" target="_blank" rel="noopener">DOWNLOAD ↓</a></div>
      </article>`;
    }).join("");
  }
  async function loadPacks() {
    if (!configured || !window.supabase) {
      status.textContent = "Setup required";
      grid.innerHTML = '<div class="empty-state"><p>Supabase is not connected yet. Follow the setup guide to publish your packs.</p></div>';
      return;
    }
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    try {
      const {data,error} = await client.from("packs").select("*").order("created_at",{ascending:false});
      if (error) throw error;
      allPacks = data || [];
      status.textContent = `${allPacks.length} pack${allPacks.length === 1 ? "" : "s"} available`;
      render();
      const {data:{session}} = await client.auth.getSession();
      showAdmin(!!session && session.user.email?.toLowerCase() === cfg.adminEmail?.toLowerCase(), session?.user.email);
    } catch (e) {
      status.textContent = "Connection error";
      grid.innerHTML = `<div class="empty-state"><p>Could not load packs: ${escapeHTML(e.message)}</p><p>Check the Supabase setup and database policies.</p></div>`;
    }
    client.auth.onAuthStateChange((_event, session) => {
      const isAdmin = !!session && session.user.email?.toLowerCase() === cfg.adminEmail?.toLowerCase();
      showAdmin(isAdmin, session?.user.email);
    });
  }
  function showAdmin(isAdmin,email) {
    $("login-panel").classList.toggle("hidden",isAdmin);
    $("upload-panel").classList.toggle("hidden",!isAdmin);
    $("admin-open").textContent = isAdmin ? "Upload pack" : "Admin login";
    $("signed-email").textContent = email || "";
  }
  $("admin-open").addEventListener("click", async () => {
    $("admin-modal").classList.remove("hidden");
    message("");
    if (client) {
      const {data:{session}} = await client.auth.getSession();
      showAdmin(!!session && session.user.email?.toLowerCase() === cfg.adminEmail?.toLowerCase(),session?.user.email);
    }
  });
  $("modal-close").addEventListener("click",()=>$("admin-modal").classList.add("hidden"));
  $("admin-modal").addEventListener("click",e=>{if(e.target === $("admin-modal")) $("admin-modal").classList.add("hidden");});
  $("login-button").addEventListener("click",async()=>{
    if (!client) return message("Connect Supabase first.",true);
    const email = $("admin-email").value.trim();
    if (!email || email.toLowerCase() !== String(cfg.adminEmail).toLowerCase()) return message("That email is not the configured admin email.",true);
    const {error} = await client.auth.signInWithOtp({email,options:{emailRedirectTo:window.location.href}});
    message(error ? error.message : "Sign-in link sent. Check your email, then return to this page.");
  });
  $("logout-button").addEventListener("click",async()=>{const {error}=await client.auth.signOut();message(error ? error.message : "Signed out.");});
  $("upload-form").addEventListener("submit",async e=>{
    e.preventDefault();
    if (!client) return message("Supabase is not connected.",true);
    const form = e.currentTarget, data = new FormData(form), file = data.get("packfile");
    if (!file || !file.name.toLowerCase().endsWith(".mcpack")) return message("Choose a .mcpack file.",true);
    const button = $("upload-button"); button.disabled = true; button.textContent = "Uploading…";
    try {
      const slug = String(data.get("slug")).toLowerCase();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
      const path = `${slug}/${Date.now()}-${safeName}`;
      const {error:uploadError} = await client.storage.from("pack-files").upload(path,file,{upsert:false,contentType:"application/octet-stream"});
      if (uploadError) throw uploadError;
      const {data:publicData} = client.storage.from("pack-files").getPublicUrl(path);
      const {error:insertError} = await client.from("packs").insert({
        name:data.get("name"),slug,version:data.get("version"),category:data.get("category"),
        description:data.get("description"),file_path:path,download_url:publicData.publicUrl
      });
      if (insertError) {
        await client.storage.from("pack-files").remove([path]);
        throw insertError;
      }
      message("Pack published successfully.");
      form.reset();
      await loadPacks();
    } catch (err) { message(err.message || "Upload failed.",true); }
    finally {button.disabled=false;button.textContent="Upload pack";}
  });
  $("search").addEventListener("input",render);
  $("filters").addEventListener("click",e=>{
    const btn=e.target.closest("[data-category]"); if(!btn)return;
    category=btn.dataset.category;
    document.querySelectorAll(".filter").forEach(b=>b.classList.toggle("active",b===btn));
    render();
  });
  loadPacks();
})();