import { randomBytes, createCipheriv, publicEncrypt, constants } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { coletarOma } from './oma.mjs'
const origem='https://app.winker.com.br'
const portais=JSON.parse(Buffer.from(process.env.ESPELHO_PORTAIS_B64,'base64')).oma
const norm=s=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toUpperCase().replace(/\s+/g,' ').trim()
const procurar=async f=>await f.locator('a,button,[role=menuitem],input[type=button]').evaluateAll(els=>[...new Set(els.map(x=>(x.innerText||x.value||x.title||'').trim()).filter(x=>/acord|negocia|repasse|honor|inadimpl|balancete|relat[óo]rio|cobran/i.test(x)&&x.length<62&&!/\d{5,}|@/.test(x)))]).catch(()=>[])
const dados={}
try {
 await coletarOma(portais,async(_c,_n,acessar)=>acessar(async(_fase,acao)=>acao()),async pagina=>{
  dados.fase='vinculos'
  const links=await pagina.locator('a[href*="changeCondominioPadrao/id/"]').evaluateAll(es=>es.map(e=>({nome:e.innerText.trim(),rota:e.pathname,origem:e.origin})))
  dados.totalVinculos=new Set(links.map(x=>x.rota)).size
  dados.vinculosAtmosfera=links.some(x=>norm(x.nome).includes('ATMOSFERA'))
  dados.rotulosAtmosfera=[...new Set(links.filter(x=>norm(x.nome).includes('ATMOSFERA')).map(x=>norm(x.nome.split('\n')[0]).split(/[@|:]/)[0].replace(/\d{4,}/g,'').slice(0,65)))]
  dados.condominios=[]
  for(const alvo of ['ATMOSFERA RESIDENCIAL']){
   const info={alvo}
   dados.condominios.push(info)
   const achados=links.filter(x=>x.origem===origem&&/^\/intra\/default\/changeCondominioPadrao\/id\/\d+$/.test(x.rota)&&norm(x.nome).includes('CYRELA ATMOSFERA 360') && (norm(x.nome).includes('STUDIO') === alvo.endsWith('STUDIOS')))
   const rotas=[...new Set(achados.map(x=>x.rota))]
   if(rotas.length!==1){info.acesso=rotas.length?'Ambíguo':'Vínculo ausente';continue}
   info.acesso='Localizado'
   try{
    await pagina.goto(origem+rotas[0],{waitUntil:'domcontentloaded'})
    await pagina.goto(origem+'/intra',{waitUntil:'domcontentloaded'})
    info.menu=await procurar(pagina)
    const balancete=pagina.locator('a:visible').filter({hasText:/Balancete interativo/i}).first()
    await balancete.click({timeout:14000})
    const financeiro=pagina.frameLocator('iframe[src*="appweb.winker.com.br"]').first()
    const relat=financeiro.getByText('Relatórios',{exact:true}).first()
    await relat.click({timeout:30000})
    await financeiro.getByText('Inadimplentes',{exact:true}).first().waitFor({state:'visible',timeout:10000}).catch(()=>{})
    const texto=await financeiro.locator('body').innerText({timeout:5000})
    info.relatorios=[...new Set(texto.split('\n').map(t=>t.trim()).filter(t=>/acord|negocia|repasse|honor|inadimpl|balancete|relat[óo]rio|cobran/i.test(t)&&t.length<55&&!/\d{5,}|@/.test(t)))]
    const candidatos=info.relatorios.filter(x=>/acordo|honor|repasse/i.test(x))
    if(candidatos.length===1){
      const atual=pagina.context().pages()
      await financeiro.getByText(candidatos[0],{exact:true}).first().click({timeout:6000})
      const limite=Date.now()+175000
      let melhor
      while(Date.now()<limite){
       const destinos=[...pagina.context().pages().filter(x=>!atual.includes(x)),pagina]
       for(const tab of destinos)for(const f of tab.frames()){
        if(!/^https:\/\/(?:app|appweb)\.winker\.com\.br\//.test(f.url()))continue
        const rota=new URL(f.url()).pathname
        const t=await f.locator('body').innerText({timeout:2000}).catch(()=>'')
        if(t && (tab!==pagina || /acordo/i.test(rota))) {
          if(!melhor || (/processando a solicita/i.test(melhor.texto) && !/processando a solicita/i.test(t)) || t.length>melhor.texto.length) melhor={rota,texto:t.slice(0,50000),nova:tab!==pagina}
          if((/honor[aá]rios|valor do repasse|nenhum (?:acordo|registro)|liquida[cç][aã]o|vencimento/i.test(t)) && !/(?:carregando|processando a solicita)/i.test(t)){
            info.relatorio=melhor
            return
          }
        }
       }
       await pagina.waitForTimeout(500)
      }
      if(melhor)info.relatorio=melhor
    }
   }catch(e){info.incompleto=e.name}
  }
 })
}catch(e){dados.incompleto=e.name}
const k=randomBytes(32),iv=randomBytes(12),c=createCipheriv('aes-256-gcm',k,iv)
const bytes=Buffer.concat([c.update(gzipSync(JSON.stringify(dados))),c.final()])
const envelope=Buffer.concat([publicEncrypt({key:Buffer.from(process.env.PUBLIC_RESULT_KEY,'base64'),padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},k),iv,c.getAuthTag(),bytes]).toString('base64')
for(let i=0;i<envelope.length;i+=1800)console.log('OMA_FIN_'+i/1800+'='+envelope.slice(i,i+1800))
