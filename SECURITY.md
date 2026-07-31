# Segurança e privacidade

## Modelo de dados

O Respira é local-first com sync opcional. O cofre no `localStorage` é criptografado. A cópia na nuvem (Neon via API Vercel) exige sessão autenticada com PIN e cookie HTTP-only.

## Criptografia local

- Derivação de chave: PBKDF2 com SHA-256 e 210.000 iterações
- Criptografia: AES-GCM de 256 bits
- Salt aleatório por cofre
- Vetor de inicialização aleatório a cada salvamento

## Limitações importantes

- Esquecer o PIN torna o cofre local inacessível (a nuvem ainda pode ser recuperada com o PIN do servidor).
- Limpar dados do navegador remove o cofre local.
- Extensões maliciosas, malware ou acesso ao dispositivo desbloqueado podem comprometer informações.
- O sistema não substitui orientação financeira, contábil ou jurídica profissional.

## Recomendações

- Use PIN exclusivo e bloqueio automático.
- Mantenha o dispositivo protegido por senha.
- Gere backup criptografado após mudanças importantes.
- Não publique arquivos de importação, backup ou `.env` no GitHub.
