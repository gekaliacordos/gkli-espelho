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
  dados.condominios=[]
  for(const alvo of ['VISO MOEMA','ATMOSFERA RESIDENCIAL','ATMOSFERA STUDIOS']){
   const info={alvo}
   dados.condominios.push(info)
   const achados=links.filter(x=>x.origem===origem&&/^\/intra\/default\/changeCondominioPadrao\/id\/\d+$/.test(x.rota)&&norm(x.nome).includes(alvo))
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
      const limite=Date.now()+12000
      while(Date.now()<limite){
       const destinos=[...pagina.context().pages().filter(x=>!atual.includes(x)),pagina]
       for(const tab of destinos)for(const f of tab.frames()){
        if(!/^https:\/\/(?:app|appweb)\.winker\.com\.br\//.test(f.url()))continue
        const t=await f.locator('body').innerText({timeout:1500}).catch(()=>'')
        if(/nenhum (?:acordo|registro)|honor[aá]rios|valor do repasse/i.test(t)){
         info.relatorio={semRegistros:/nenhum (?:acordo|registro)/i.test(t),honorarios:/honor[aá]rios/i.test(t),repasse:/valor do repasse/i.test(t)}
        }
       }
       if(info.relatorio)break
       await pagina.waitForTimeout(500)
      }
    }
   }catch(e){info.incompleto=e.name}
  }
 })
}catch(e){dados.incompleto=e.name}
console.log('OMA_NAVEGACAO',JSON.stringify(dados))
