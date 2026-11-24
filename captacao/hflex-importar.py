import hashlib
import json
import re
import sys
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path

data_br = r'\d{2}/\d{2}/\d{4}'

def centavos(valor):
    if not re.fullmatch(r'-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2}', valor):
        raise ValueError('Valor monetário inválido.')
    return int(valor.replace('.', '').replace(',', ''))

def data(valor):
    return datetime.strptime(valor, '%d/%m/%Y').date().isoformat()

class GradeHtml(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.linhas = []
        self.linha = None
        self.celula = None
    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.linha = []
        elif tag in ('td', 'th') and self.linha is not None:
            self.celula = []
        elif tag == 'br' and self.celula is not None:
            self.celula.append(' ')
    def handle_data(self, dados):
        if self.celula is not None:
            self.celula.append(dados)
    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.celula is not None and self.linha is not None:
            self.linha.append(' '.join(''.join(self.celula).split()))
            self.celula = None
        elif tag == 'tr' and self.linha is not None:
            if any(self.linha):
                self.linhas.append(self.linha)
            self.linha = None

def abrir_xls(arg):
    conteudo = Path(arg).read_bytes()
    if not re.search(rb'<table\b', conteudo, re.I):
        raise ValueError('O arquivo não é uma exportação XLS HTML do HFlex.')
    grade = GradeHtml()
    grade.feed(conteudo.decode('utf-8-sig'))
    return grade.linhas, hashlib.sha256(conteudo).hexdigest()

bloco = sys.argv[3] if len(sys.argv) > 3 else 'RIO NEGRO'
sintetico, hash_sintetico = abrir_xls(sys.argv[1])
assert any(len(r) == 18 and r[4] == 'Nº Acordo' for r in sintetico)
acordos = {}
for r in sintetico:
    if len(r) != 18 or not r[4].isdigit():
        continue
    numero = r[4]
    assert numero not in acordos and ((r[0] == bloco and r[1].isdigit()) or (not r[1] and r[3].isdigit()))
    total, recebido = centavos(r[16]), centavos(r[17])
    acordos[numero] = dict(numero=numero, unidade=r[1] or 'Contrato ' + r[3],
        dataPosicao=data(r[6]), principal=centavos(r[9]), total=total, recebido=recebido, saldo=total-recebido)
assert acordos, 'O XLS sintético não contém acordos identificáveis.'

devedores, hash_devedores = abrir_xls(sys.argv[2])
cotas = []
chaves = set()
unidades = set()
unidade = None
sub = []
geral = False
colunas = None
obrigatorias = ("RECIBO", "ACORDO", "VENCIMENTO", "VALOR", "MULTA", "JUROS", "CORREÇÃO", "CORRIGIDO")
def conferir(r, lista):
    assert int(next(m[1] for valor in r if (m := re.fullmatch(r'RECIBOS:\s*(\d+)', valor)))) == len(lista)
    assert centavos(r[-1]) == sum(c['valores'][-1] for c in lista)

for r in devedores:
    if len(r) >= 3 and r[0] == bloco and re.fullmatch(r'\d{6}', r[1]):
        assert unidade is None and not geral
        unidade = r[1]
        unidades.add(unidade)
        continue
    if r[0].startswith('RESUMO DA UNIDADE'):
        assert r[0] == 'RESUMO DA UNIDADE ' + unidade
        conferir(r, sub)
        unidade, sub = None, []
        continue
    if r[0] == 'RESUMO DO BLOCO ' + bloco:
        assert unidade is None and not geral
        conferir(r, cotas)
        geral = True
        continue
    if r[0] == 'RECIBO':
        assert len(set(r)) == len(r) and all(campo in r for campo in obrigatorias)
        colunas = {campo: r.index(campo) for campo in obrigatorias}
        colunas['TOTAL_ORIGEM'] = r.index('TOTAL') if 'TOTAL' in r else colunas['CORRIGIDO']
        continue
    if colunas is None or not re.fullmatch(r'\d{6,}', r[0]):
        continue
    assert len(r) > max(colunas.values())
    recibo = r[colunas['RECIBO']]
    vencimento = r[colunas['VENCIMENTO']]
    assert re.fullmatch(data_br, vencimento)
    chave = (unidade, recibo)
    assert unidade and not geral and chave not in chaves
    chaves.add(chave)
    cota = dict(unidade=unidade, recibo=recibo, vencimento=data(vencimento), acordoOrigem=r[colunas['ACORDO']] or None,
                valores=[centavos(r[colunas[campo]]) for campo in ('VALOR','MULTA','JUROS','CORREÇÃO','TOTAL_ORIGEM')])
    cotas.append(cota)
    sub.append(cota)
assert geral and unidade is None, 'Fechamento do relatório de devedores ausente.'

print(json.dumps(dict(unidades=sorted(unidades), cotas=cotas, acordos=list(acordos.values()),
    hashes=dict(relatorioDevedoresSha256=hash_devedores, relatorioAcordosSinteticoSha256=hash_sintetico)), ensure_ascii=False))
