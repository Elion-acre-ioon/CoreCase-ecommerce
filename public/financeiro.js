montarNavAdmin('financeiro');

async function carregarConfiguracao() {

    const resposta =
    await adminFetch('/api/configuracoes');

    const dados =
    await resposta.json();

    document.getElementById('public_key').value =
    dados.public_key || '';

    document.getElementById('access_token').value =
    dados.access_token || '';

    document.getElementById('chave_pix').value =
    dados.chave_pix || '';

    document.getElementById('nome_recebedor').value =
    dados.nome_recebedor || '';

    document.getElementById('ambiente').value =
    dados.ambiente || 'sandbox';

}

async function salvarConfiguracao(event){

    event.preventDefault();

    const dados = {

        public_key:
        document.getElementById('public_key').value,

        access_token:
        document.getElementById('access_token').value,

        chave_pix:
        document.getElementById('chave_pix').value,

        nome_recebedor:
        document.getElementById('nome_recebedor').value,

        ambiente:
        document.getElementById('ambiente').value

    };

    const resposta =
    await adminFetch('/api/configuracoes',{

        method:'PUT',

        headers:{
            'Content-Type':'application/json'
        },

        body:JSON.stringify(dados)

    });

    const resultado =
    await resposta.json();

    if(resultado.sucesso){

        alert(
        'Configurações salvas com sucesso.'
        );

    }else{

        alert(
        'Erro ao salvar.'
        );

    }

}

carregarConfiguracao();
