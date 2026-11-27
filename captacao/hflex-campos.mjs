import { baixarRelatoriosHflex } from './hflex.mjs'
import { randomBytes, createCipheriv, publicEncrypt, constants } from 'node:crypto'
import { gzipSync } from 'node:zlib'
const alvos = JSON.parse(process.env.ALVOS_HFLEX)
const campos = ['repasse','honorario','taxa administrativa','comissao','principal','recibo','parcela','vencimento','pagamento','recebido','liquidacao','desconto','juros','multa','correcao','custas','despesas','credito','baixa']
const norm = s=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase()
const presentes=t=>campos.filter(c=>new RegExp('\\b'+c+'s?\\b').test(norm(t)))
const credenciais={usuario:process.env.ESPELHO_PORTAL_USUARIO,senha:process.env.ESPELHO_PORTAL_SENHA}
for(const alvo of alvos){
 const dados={}
 try {
  await baixarRelatoriosHflex(credenciais,{},alvo,()=>{},async page=>{
   await page.locator('#body_tbNumeroAcordo').fill(alvo.numero)
   await page.getByRole('checkbox',{name:'TODOS STATUS',exact:true}).check()
   dados.etapa='controles'
   const relatorios=await page.locator('input[type=submit],input[type=button],button,a').evaluateAll(els=>els.map(e=>({id:e.id,rotulo:e.value||e.innerText||e.title||''})).filter(e=>/relat[oó]rio.*(?:detalhado|sint[eé]tico)|repasse|honor[aá]rio/i.test(e.rotulo)&&e.rotulo.length<60))
   dados.controles=relatorios.map(e=>e.rotulo)
   dados.menu=await page.locator('a').evaluateAll(els=>els.map(e=>e.innerText.trim()).filter(t=>/repasse|honor|financeir|prestaç[aã]o de contas/i.test(t)&&t.length<65))
   const detalhado=relatorios.find(x=>/relat[oó]rio detalhado/i.test(x.rotulo)&&x.id)
   if(!detalhado)return
   const context=page.context(), abas=[page]
   context.on('page',a=>abas.push(a))
   await page.locator('[id="'+detalhado.id+'"]').click({timeout:10000})
   const prazo=Date.now()+90000
   while(Date.now()<prazo){
    for(const a of abas.slice()){
     if(a.isClosed())continue
     for(const f of a.frames()){
      if(!/^https:\/\/sys\.livefacilities\.com\.br\/Operacional\/Relatorio\/RelatorioAcordoDetalhado\.aspx/i.test(f.url()))continue
      const r=await f.locator('body').evaluate(el=>{
       const txt=el.innerText
       const tabelas=[...el.querySelectorAll('table')].filter(t=>!t.querySelector('table'))
         .map(t=>[...t.rows].map(r=>[...r.cells].map(c=>c.innerText.trim())))
       return {txt,tabelas}
      }).catch(()=>null)
      if(r&&r.txt.includes('Nº ACORDO: '+alvo.numero)&&/DETALHE DO ACORDO|PARCELA/i.test(r.txt)){
       dados.relatorio=r
       return
      }
     }
    }
    await new Promise(r=>setTimeout(r,500))
   }
  })
 }catch(e){dados.incompleto=true;dados.tipo=e.name}
 const chave=randomBytes(32),iv=randomBytes(12)
 const c=createCipheriv('aes-256-gcm',chave,iv)
 const conteudo=Buffer.concat([c.update(gzipSync(JSON.stringify({codigo:alvo.codigoPortal,...dados}))),c.final()])
 const envelope=Buffer.concat([publicEncrypt({key:Buffer.from(process.env.PUBLIC_RESULT_KEY,'base64'),padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},chave),iv,c.getAuthTag(),conteudo]).toString('base64')
 for(let i=0;i<envelope.length;i+=1800)console.log('HF_'+alvo.numero+'_'+i/1800+'='+envelope.slice(i,i+1800))
}
