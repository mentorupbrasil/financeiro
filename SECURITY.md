# Segurança e privacidade

## Modelo de dados

O Respira é local-first. Não envia dados financeiros para servidor, API, analytics ou repositório. O conteúdo é salvo no `localStorage` do navegador somente depois de ser criptografado.

## Criptografia

- Derivação de chave: PBKDF2 com SHA-256 e 210.000 iterações
- Criptografia: AES-GCM de 256 bits
- Salt aleatório por cofre
- Vetor de inicialização aleatório a cada salvamento

## Limitações importantes

- Esquecer o PIN torna o cofre inacessível.
- Limpar dados do navegador remove o cofre local.
- Extensões maliciosas, malware ou acesso ao dispositivo desbloqueado podem comprometer informações.
- O sistema não substitui orientação financeira, contábil ou jurídica profissional.

## Recomendações

- Use PIN exclusivo.
- Ative bloqueio automático.
- Mantenha o dispositivo protegido por senha.
- Gere backup após cada fechamento mensal.
- Não publique arquivos de importação ou backup no GitHub.
