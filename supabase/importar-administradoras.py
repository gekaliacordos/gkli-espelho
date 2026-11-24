"""Emite SQL para importar o CSV do GKLI pelo editor SQL ou pelo psql."""
import argparse
import csv
import json
from pathlib import Path
from uuid import UUID


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    args = parser.parse_args()
    with args.csv.open(encoding="utf-8-sig", newline="") as source:
        dialect = csv.Sniffer().sniff(source.read(4096), delimiters=",;\t")
        source.seek(0)
        rows = list(csv.DictReader(source, dialect=dialect))

    fields = (
        "id", "nome", "nome_operacional", "cnpj", "telefone", "email", "site",
        "status", "responsavel_interno", "observacoes", "acesso_gerar_acordo",
    )
    if not rows or any(field not in rows[0] for field in fields[:3]):
        parser.error("o CSV precisa ter linhas com id, nome e nome_operacional")

    values = []
    for row in rows:
        source_id = str(UUID(row["id"]))
        name = row["nome"].strip()
        short_name = row["nome_operacional"].strip() or name
        if not name:
            parser.error("há uma administradora sem nome")
        cadastro = {field: row[field] for field in fields[3:] if row.get(field)}
        values.append(
            f"(public.chave_administradora({literal(short_name)}), {literal(name)}, "
            f"{literal(short_name)}, {literal(source_id)}::uuid, "
            f"{literal(json.dumps(cadastro, ensure_ascii=False))}::jsonb)"
        )

    print("begin;")
    print("insert into public.administradoras (chave, nome, nome_operacional, gkli_id, cadastro) values")
    print(",\n".join(values))
    print("""on conflict (chave) do update set nome = excluded.nome, nome_operacional = excluded.nome_operacional,
  gkli_id = excluded.gkli_id, cadastro = excluded.cadastro;
update public.condominios set cadastro = cadastro;
update public.captacoes set administradora = administradora;
delete from public.administradoras a where a.gkli_id is null and a.cadastro = '{}'::jsonb
  and exists (select 1 from public.administradoras oficial
    where oficial.gkli_id is not null and public.chave_administradora(oficial.nome) = a.chave)
  and not exists (select 1 from public.condominios c where c.administradora_chave = a.chave)
  and not exists (select 1 from public.captacoes c where c.administradora_chave = a.chave);
commit;""")


if __name__ == "__main__":
    main()
