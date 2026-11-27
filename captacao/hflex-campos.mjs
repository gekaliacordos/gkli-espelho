import { baixarRelatoriosHflex } from './hflex.mjs'
import { execFileSync } from 'node:child_process'
const alvos = JSON.parse(process.env.ALVOS_HFLEX)
const campos = ['repasse','honorario','taxa administrativa','comissao','principal','recibo','parcela','vencimento','pagamento','recebido','liquidacao','desconto','juros','multa','correcao','custas','despesas','credito','baixa']
const norm = s=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase()
const presentes=t=>campos.filter(c=>new RegExp('\\b'+c+'s?\\b').test(norm(t)))
const credenciais={usuario:process.env.ESPELHO_PORTAL_USUARIO,senha:process.env.ESPELHO_PORTAL_SENHA}
for(const alvo of alvos){
 const dados={}
 try {
  await baixarRelatoriosHflex(credenciais,{},alvo,()=>{},async page=>{
   dados.etapa='controles'
   const relatorios=await page.locator('input[type=submit],input[type=button],button,a').evaluateAll(els=>els.map(e=>({id:e.id,rotulo:e.value||e.innerText||e.title||''})).filter(e=>/relat[oó]rio.*(?:detalhado|sint[eé]tico)|repasse|honor[aá]rio/i.test(e.rotulo)&&e.rotulo.length<60))
   dados.controles=relatorios.map(e=>e.rotulo)
   dados.menu=await page.locator('a').evaluateAll(els=>els.map(e=>e.innerText.trim()).filter(t=>/repasse|honor|financeir|prestaç[aã]o de contas/i.test(t)&&t.length<65))
   const detalhado=relatorios.find(x=>/relat[oó]rio detalhado/i.test(x.rotulo)&&x.id)
   if(!detalhado)return
   const context=page.context(), downloads=[], abas=[page]
   const observar=p=>{abas.push(p);p.on('download',d=>downloads.push(d))}
   page.on('download',d=>downloads.push(d))
   context.on('page',observar)
   dados.etapa='acionar'
   await page.locator('[id="'+detalhado.id+'"]').click({timeout:10000})
   dados.etapa='aguardar'
   const prazo=Date.now()+95000
   const rotas=new Set()
   let acionado=false
   while(Date.now()<prazo){
    for(const d of downloads.splice(0)){
     const x=await d.path()
     try {
      const leitura=execFileSync('pdftotext',['-layout',x,'-'],{encoding:'utf8',stdio:['ignore','pipe','ignore']})
      if(leitura.trim()&&/acordo/i.test(leitura)){dados.pdf=presentes(leitura);dados.etapa='pdf';return}
     } catch {}
    }
    for(const a of abas.slice()){
     if(a.isClosed())continue
     for(const f of a.frames()){
      const u=new URL(f.url())
      if(u.origin!=='https://sys.livefacilities.com.br'||!/RelatorioAcordoDetalhado/i.test(u.pathname))continue
      rotas.add(u.pathname)
      dados.rotas=[...rotas]
      const t=await f.locator('body').innerText({timeout:2500}).catch(()=>'')
      const d=presentes(t)
      if(d.length>(dados.detalhado?.length??0))dados.detalhado=d
      const pdf=f.locator('#btRelatorioPDF,#btRelatorioPdf,[title*="PDF" i]:visible').first()
      if(!acionado&&await pdf.isVisible()){
       acionado=true
       if(f===a.mainFrame())await pdf.click({timeout:5000})
       else {
        const nova=await context.newPage()
        await nova.goto(u.href,{waitUntil:'domcontentloaded'})
        await nova.locator('#btRelatorioPDF,#btRelatorioPdf,[title*="PDF" i]:visible').first().click({timeout:12000})
       }
      }
      if(d.includes('recibo')&&d.includes('parcela')&&!acionado){dados.etapa='texto';return}
     }
    }
    await new Promise(r=>setTimeout(r,600))
   }
  })
 }catch{dados.incompleto=true}
 console.log('HFLEX_CAMPOS',JSON.stringify({codigo:alvo.codigoPortal,...dados}))
}
