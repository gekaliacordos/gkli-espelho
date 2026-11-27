import { baixarRelatoriosHflex } from './hflex.mjs'
import { execFileSync } from 'node:child_process'
const alvos = JSON.parse(process.env.ALVOS_HFLEX)
const campos = ['repasse','honorarios','taxa administrativa','comissao','principal','recibo','parcela','vencimento','pagamento','recebido','liquidacao','desconto','juros','multa','correcao','custas','despesas','credito','baixa']
const norm = s=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase()
const presentes=t=>campos.filter(c=>new RegExp('\\b'+c+'s?\\b').test(norm(t)))
const credenciais={usuario:process.env.ESPELHO_PORTAL_USUARIO,senha:process.env.ESPELHO_PORTAL_SENHA}
for(const alvo of alvos){
 const dados={}
 try {
  await baixarRelatoriosHflex(credenciais,{},alvo,()=>{},async page=>{
   dados.menu=await page.locator('a').evaluateAll(els=>['repasse','honor','financeir','prestacao de contas'].filter(k=>els.some(el=>el.innerText.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().includes(k))))
   await page.getByRole('button',{name:'Pesquisar',exact:true}).click()
   await page.locator('#tblListaBoletoFooter').waitFor({state:'visible'})
   dados.grade=presentes(await page.locator('table:has(#tblListaBoletoFooter), #tblListaBoletoFooter').first().innerText())
   const espera=page.waitForEvent('popup',{timeout:120000})
   espera.catch(()=>{})
   await page.getByRole('button',{name:'Relatório Detalhado',exact:true}).click()
   const popup=await espera
   await popup.waitForLoadState('domcontentloaded')
   const url=new URL(popup.url())
   if(url.origin!=='https://sys.livefacilities.com.br'||url.pathname!=='/Operacional/Relatorio/RelatorioAcordoDetalhado.aspx'||!url.searchParams.get('p'))throw Error('Relatório divergente')
   dados.detalhado=[]
   for(let i=0;i<24;i++){
    const textos=await Promise.all(popup.frames().map(f=>f.locator('body').innerText({timeout:2000}).catch(()=>'')))
    dados.detalhado=presentes(textos.join(' '))
    if(dados.detalhado.includes('recibo')&&dados.detalhado.includes('parcela'))break
    await new Promise(r=>setTimeout(r,2000))
   }
   const botao=popup.locator('[title*="PDF" i]:visible, a[href$=".pdf" i]:visible').first()
   if(await botao.count()){
    const download=popup.waitForEvent('download',{timeout:90000});download.catch(()=>{})
    await botao.click()
    const arquivo=await (await download).path()
    const leitura=execFileSync('pdftotext',['-layout',arquivo,'-'],{encoding:'utf8'})
    if(leitura.trim()) dados.pdf=presentes(leitura)
   }
  })
 }catch{dados.incompleto=true}
 console.log('HFLEX_CAMPOS',JSON.stringify({codigo:alvo.codigoPortal,...dados}))
}
