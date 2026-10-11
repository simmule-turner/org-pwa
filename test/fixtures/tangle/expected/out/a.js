// [[file:../n1.org::*Top][Top:3]]
start();
// [[file:n1.org::helper][helper]]
function h() { return 1; }
// helper ends here
  // [[file:n1.org::wrapper][wrapper]]
  before();
    function h() { return 1; }
  after();
  // wrapper ends here
end();
// Top:3 ends here
