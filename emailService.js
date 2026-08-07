const FROM_EMAIL = process.env.EMAIL_FROM || 'Core Case <no-reply@corecase.local>';

function appBaseUrl() {
    return (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function mascararUrl(url) {
    try {
        const parsed = new URL(url);
        if (parsed.searchParams.has('token')) parsed.searchParams.set('token', '***');
        return parsed.toString();
    } catch (e) {
        return '[url-invalida]';
    }
}

async function obterTransporter() {
    if (!process.env.SMTP_HOST) return null;

    let nodemailer;
    try {
        nodemailer = require('nodemailer');
    } catch (erro) {
        // TODO ajuste manual: rode "npm install" depois de adicionar nodemailer, ou configure outro provedor de e-mail.
        console.warn('[emailService] nodemailer nao instalado; e-mail real desativado:', erro.message);
        return null;
    }

    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
        auth: process.env.SMTP_USER ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS || ''
        } : undefined
    });
}

async function enviarEmailRecuperacaoSenha({ para, nome, token }) {
    const link = `${appBaseUrl()}/redefinir-senha.html?token=${encodeURIComponent(token)}`;
    const assunto = 'Recuperacao de senha - Core Case';
    const texto = `Ola ${nome || 'cliente'},\n\nUse o link abaixo para redefinir sua senha. Ele expira em 45 minutos e so pode ser usado uma vez.\n\n${link}\n\nSe voce nao solicitou essa alteracao, ignore este e-mail.`;
    const html = `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#222;max-width:560px;margin:auto;padding:24px;">
            <h2 style="color:#111;">Recuperacao de senha</h2>
            <p>Ola ${nome || 'cliente'},</p>
            <p>Use o botao abaixo para redefinir sua senha. O link expira em 45 minutos e so pode ser usado uma vez.</p>
            <p><a href="${link}" style="display:inline-block;background:#9B0000;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:bold;">Redefinir senha</a></p>
            <p style="font-size:13px;color:#666;">Se o botao nao funcionar, copie e cole este link no navegador:<br>${link}</p>
            <p style="font-size:13px;color:#666;">Se voce nao solicitou essa alteracao, ignore este e-mail.</p>
        </div>
    `;

    const transporter = await obterTransporter();
    if (!transporter || process.env.EMAIL_TEST_MODE === 'true') {
        // TODO ajuste manual: configurar SMTP_HOST/SMTP_USER/SMTP_PASS/EMAIL_FROM em producao para envio real.
        console.info('[emailService] Modo teste: link de recuperacao gerado:', mascararUrl(link));
        return { modoTeste: true };
    }

    await transporter.sendMail({ from: FROM_EMAIL, to: para, subject: assunto, text: texto, html });
    return { enviado: true };
}

module.exports = { enviarEmailRecuperacaoSenha };
