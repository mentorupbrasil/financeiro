export default function handler(_req, res) {
  res.status(200).json({
    ok: true,
    app: 'Respira',
    brand: 'GestorPro',
    domain: 'financeiro.gestorpro.sbs',
  });
}
