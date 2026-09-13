document.querySelectorAll('[data-share-url]').forEach(function(button){
  button.hidden=false;
  button.addEventListener('click',async function(){
    var data={title:button.dataset.shareTitle,url:button.dataset.shareUrl};
    var status=document.getElementById('shareStatus');
    try{
      if(navigator.share){await navigator.share(data);}
      else if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(data.url);status.textContent='Link copiado. Cole na conversa em que deseja compartilhar.';}
      else{status.textContent='Copie este link: '+data.url;}
    }catch(error){if(error.name!=='AbortError')status.textContent='Não foi possível compartilhar. Copie este link: '+data.url;}
  });
});