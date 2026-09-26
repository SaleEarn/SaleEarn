
(function(){
  window.SALE_EARN_CONTACT_ENDPOINT = window.SALE_EARN_CONTACT_ENDPOINT || "/api/contact";

  window.submitSaleEarnContact = async function(form){
    const btn = form.querySelector('button[type="submit"],button');
    const original = btn ? btn.textContent : "";
    const data = {
      name: (form.querySelector('[name="name"]')||{}).value?.trim() || "",
      email: (form.querySelector('[name="email"]')||{}).value?.trim() || "",
      subject: (form.querySelector('[name="subject"]')||{}).value?.trim() || "Sale Earn Contact",
      message: (form.querySelector('[name="message"]')||{}).value?.trim() || ""
    };
    if(!data.name || !data.email || !data.message){
      alert("Please fill Name, Email and Message.");
      return false;
    }
    if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(data.email)){
      alert("Please enter a valid email address.");
      return false;
    }
    if(btn){ btn.disabled=true; btn.textContent="Sending..."; }
    try{
      const res=await fetch(window.SALE_EARN_CONTACT_ENDPOINT,{
        method:"POST",
        headers:{"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify(data)
      });
      let out={};
      try{ out=await res.json(); }catch(_){}
      if(!res.ok || out.success===false) throw new Error(out.message||"Unable to send message.");
      alert("Message sent successfully.");
      form.reset();
    }catch(err){
      alert(err.message||"Unable to send message. Please try again.");
    }finally{
      if(btn){ btn.disabled=false; btn.textContent=original; }
    }
    return false;
  };
})();
