/**
 * The expressions the Lisp interpreter is compared with Emacs 29.3 on (tools/gen-elisp-oracle.mjs, test/elisp.test.js).
 * A string is evaluated with lexical binding; `{ src, lexical: false }` is Emacs's plain `eval`. Cases run in this order in one
 * session, so a `defun` stays defined for the cases after it.
 */

/** @type {(string | { src: string, lexical: boolean })[]} */
export const CASES = [
  // ---- numbers
  '(+ 1 2)', '(+)', '(*)', '(- 5)', '(- 10 3 2)', '(* 2 3 4)', '(/ 7 2)', '(/ -7 2)', '(/ 7 2.0)', '(/ 5)', '(/ 2.0)', '(/ 100 5 2)',
  '(% 7 3)', '(% -7 3)', '(mod -7 3)', '(mod 7 -3)', '(mod 5.5 2)', '(mod -5.5 2)', '(1+ 1)', '(1- 1)', '(1+ 1.5)',
  '(+ 1 2.0)', '(* 1.5 2)', '(+ 0.1 0.2)', '(- 0.0)', '(- 0)', '(* 1.0 0)', '(/ 0.0 0.0)', '(/ 1 0.0)', '(/ -1 0.0)',
  '(= 1 1.0)', '(= 1 2)', '(< 1 2 3)', '(< 1 3 2)', '(> 3 2 1)', '(<= 1 1 2)', '(>= 2 2 1)', '(/= 1 2)', '(/= 1 1)',
  '(max 1 2 3)', '(max 1 2.0)', '(max 3 2.0)', '(min 1 2 3)', '(min 1.0 2)', '(min 3 3.0)', '(abs -5)', '(abs -5.5)', '(abs 0)',
  '(float 3)', '(float 3.5)', '(truncate 3.7)', '(truncate -3.7)', '(floor 3.7)', '(floor -3.7)', '(ceiling 3.2)', '(ceiling -3.2)',
  '(round 3.5)', '(round 2.5)', '(round -2.5)', '(round 3.4)', '(round 7 2)', '(round 5 2)', '(round -5 2)', '(floor 7 2)', '(floor -7 2)',
  '(ceiling 7 2)', '(truncate -7 2)', '(round 1.5)', '(round 0.5)', '(round -0.5)', '(ffloor 3.7)', '(fceiling 3.2)', '(fround 2.5)', '(ftruncate -3.7)',
  '(sqrt 16)', '(sqrt 2)', '(sqrt -1)', '(expt 2 10)', '(expt 2 0.5)', '(expt 2.0 3)', '(expt 2 100)', '(expt 0 0)', '(expt 2 -1)',
  '(exp 0)', '(exp 1)', '(log 1)', '(log 100 10)', '(log 8 2)', '(sin 0)', '(cos 0)', '(atan 1 1)', '(atan 1)',
  '(* 99999999999 99999999999)', '(+ 4611686018427387903 4611686018427387903)', '(- most-negative-fixnum 1)', 'most-positive-fixnum', '(* 3 most-positive-fixnum)',
  '(logand 12 10)', '(logior 12 10)', '(logxor 12 10)', '(lognot 5)', '(ash 1 10)', '(ash 1024 -3)', '(ash -8 -1)',
  '(zerop 0)', '(zerop 0.0)', '(zerop 1)', '(natnump 5)', '(natnump -5)', '(integerp 1)', '(integerp 1.0)', '(floatp 1.0)', '(numberp 1)', '(numberp "1")',
  '(cl-evenp 4)', '(cl-oddp 4)', '(cl-plusp 3)', '(cl-minusp 3)', '(isnan (/ 0.0 0.0))',
  '(+ 1 "a")', '(+ nil 1)', '(1+ nil)', '(/ 1 0)', '(% 1 0)', '(mod 1 0)', '(% 1.5 2)', '(< 1 "a")', '(max "a")', '(floor 1 0)', '(abs "x")', '(sqrt "x")', '(logand 1.5 2)',
  '(eq 1.0 1.0)', '(eql 1.0 1.0)', '(eql 1 1.0)', '(equal 1.0 1.0)', '(equal 1 1.0)', '(eq 100 100)', '(eql 0.0 -0.0)', '(= 0.0 -0.0)',
  '1.0', '100000.0', '1e15', '1e16', '123456789012345678.0', '0.0001', '0.00001', '1.5e-7', '-0.0', '0.1', '(/ 1.0 3)', '1e300', '1234567.125', '(/ 0.0 0.0)', '(/ 1.0 0.0)', '(/ -1.0 0.0)',
  '5.', '+5', '-5', '.5', '1.e3', '#xff', '#o17', '#b101', '?a', '?\\n', '?\\C-a', '?\\x41', '?\\s',
  '(number-to-string 1.5)', '(number-to-string 10)', '(number-to-string 1e20)', '(string-to-number "12abc")', '(string-to-number "1e3")', '(string-to-number ".5")', '(string-to-number "abc")',
  '(string-to-number " 42")', '(string-to-number "-3.5e2x")', '(string-to-number "ff" 16)', '(string-to-number "101" 2)', '(string-to-number "1.")', '(string-to-number "0x10")', '(string-to-number "")',

  // ---- format
  '(format "%s" 1.0)', '(format "%d" 3.7)', '(format "%d" -3.7)', '(format "%5.2f|" 3.14159)', '(format "%e" 12345.678)', '(format "%g" 1e-5)', '(format "%g" 123456789.0)',
  '(format "%g" 100.0)', '(format "%g" 0.5)', '(format "%x" 255)', '(format "%X" 255)', '(format "%o" 8)', '(format "%c" 65)', '(format "%-6s|" "ab")', '(format "%6s|" "ab")',
  '(format "%06.1f" 3.14159)', '(format "%S" "a\\"b")', '(format "%S" \'(1 "two" three))', '(format "%s" \'(1 "two" three))', '(format "%+d" 5)', '(format "% d" 5)', '(format "%#x" 255)', '(format "%#o" 8)',
  '(format "%3$s %1$s" 1 2 3)', '(format "%%")', '(format "%5%")', '(format "%.2s" "abcdef")', '(format "%05d" 42)', '(format "%-5d|" 42)', '(format "%5d|" -42)', '(format "%05d" -42)',
  '(format "%.3d" 5)', '(format "%x" -255)', '(format "%d" 12345678901234567890)', '(format "%s and %s" "a" \'b)', '(format "%s" nil)', '(format "%S" nil)', '(format "%s" [1 2])',
  '(format "%f" 2.5)', '(format "%.0f" 2.5)', '(format "%.0f" 3.5)', '(format "%.2f" 0.125)', '(format "%.1f" 0.05)', '(format "%f" 1e10)', '(format "%e" 0.0)', '(format "%g" 1234567.0)', '(format "%.3g" 3.14159)',
  '(format "%d" "x")', '(format "%s")', '(format "%z" 1)', '(format "%c" "a")', '(format "abc" 1 2)', '(format "%d%%" 50)', '(format "%s" "é")', '(format "%3s|" "é")',
  '(format-message "a %s" 1)', '(format-message "`a\' %s" "`b\'")', '(format "%f" (/ 0.0 0.0))', '(format "%s" (/ 0.0 0.0))', '(error "it\'s `x\'")', '(condition-case e (error "don\'t") (error (cadr e)))', '(format "%-8.3f|" 3.14159)', '(format "%+.2f" 2.0)', '(format "%10.4e|" 1234.5)', '(format "%s" 1e-5)', '(format "%s" 12345678901234567890.0)', '(format "%d" most-positive-fixnum)',

  // ---- printing
  '(prin1-to-string 1.5)', '(prin1-to-string "a\\nb")', '(prin1-to-string \'a)', '(prin1-to-string \'(a . b))', '(prin1-to-string \'(a b . c))', '(prin1-to-string \'(quote a))', '(prin1-to-string \'(function f))',
  '(prin1-to-string \'(quote a b))', '(prin1-to-string \'(\\` (a (\\, b) (\\,@ c))))', '(prin1-to-string [1 2 (3)])', '(prin1-to-string nil)', '(prin1-to-string t)', '(prin1-to-string \'())', '(prin1-to-string ())',
  '(prin1-to-string (intern "a b"))', '(prin1-to-string (intern "1"))', '(prin1-to-string (intern "?x"))', '(prin1-to-string (intern ""))', '(prin1-to-string (intern "a,b"))', '(prin1-to-string (intern "a;b"))', '(prin1-to-string (intern "."))',
  '(prin1-to-string (intern "-1.5"))', '(prin1-to-string (intern "+"))', '(prin1-to-string (intern "1+"))', '(prin1-to-string :key)', '(prin1-to-string (make-symbol "g"))', '(prin1-to-string "é")', '(prin1-to-string "a\\\\b")',
  '(prin1-to-string "a" t)', '(prin1-to-string \'(1 "a") t)', '(prin1-to-string (list 1 (list 2 (list 3))))', '(prin1-to-string \'((a . 1) (b . 2)))', '(prin1-to-string (cons 1 (cons 2 nil)))',
  '(prin1-to-string (lambda (x) x))', '(prin1-to-string \'(lambda (x) x))', '(prin1-to-string (symbol-function \'car))',
  '(prin1-to-string 1e100)', '(prin1-to-string -1.5e-10)', '(prin1-to-string (expt 2 70))', '(prin1-to-string ?a)', '(prin1-to-string "\\t")', '(prin1-to-string "\\e")',
  '(with-output-to-string (princ "hi") (princ 42) (prin1 "q") (terpri) (print \'x))', '(with-output-to-string (princ 1.0) (princ \'(a "b")) (prin1 \'(a "b")))', '(with-output-to-string (write-char ?x))',
  '(progn (princ "x") 5)', '(progn (print 1) (print "a") 2)', '(progn (message "hello %d" 5) 1)', '(progn (message "a") (message "b %s" \'c) 0)', '(message nil)', '(message "%s" "x")', '(progn (terpri) (prin1 \'a) (princ " ") 7)',

  // ---- lists
  '(cons 1 2)', '(cons 1 \'(2 3))', '(list)', '(list 1 2 3)', '(car \'(1 2))', '(cdr \'(1 2))', '(car nil)', '(cdr nil)', '(car 1)', '(cdr "a")', '(car-safe 1)', '(cdr-safe \'(1 . 2))', '(cadr \'(1 2 3))', '(cddr \'(1 2 3))', '(caar \'((1) 2))', '(caddr \'(1 2 3))',
  '(nth 1 \'(a b c))', '(nth 5 \'(a b c))', '(nth -1 \'(a b c))', '(nthcdr 2 \'(a b c d))', '(nthcdr 9 \'(a))', '(elt \'(a b c) 1)', '(elt [a b c] 2)', '(elt \'(a b) 5)', '(last \'(1 2 3))', '(last \'(1 2 3) 2)', '(last nil)', '(butlast \'(1 2 3))', '(butlast \'(1 2 3) 2)', '(take 2 \'(1 2 3))', '(take 9 \'(1 2))',
  '(length \'(1 2 3))', '(length "héllo")', '(length [1 2])', '(length nil)', '(length \'(1 . 2))', '(length 5)', '(length= \'(1 2) 2)', '(length< \'(1 2) 3)', '(length> \'(1 2) 3)', '(safe-length \'(1 2 . 3))',
  '(append \'(1 2) \'(3 4))', '(append \'(1) nil \'(2) 3)', '(append [1 2] nil)', '(append "ab" nil)', '(append)', '(append nil nil)', '(append \'(1) 2)', '(nconc (list 1 2) (list 3))', '(nconc nil (list 1) nil (list 2))', '(nconc)',
  '(reverse \'(1 2 3))', '(reverse [1 2 3])', '(reverse "abc")', '(nreverse (list 1 2 3))', '(let ((l (list 1 2 3))) (nreverse l) l)', '(copy-sequence \'(1 2))', '(copy-tree \'(1 (2 3)))', '(copy-alist \'((a . 1) (b . 2)))',
  '(make-list 3 \'x)', '(number-sequence 1 5)', '(number-sequence 5 1 -2)', '(number-sequence 1 2 0.5)', '(number-sequence 3)', '(number-sequence 1 10 3)', '(flatten-tree \'(1 (2 (3 nil 4)) 5))', '(ensure-list 1)', '(ensure-list \'(1))',
  '(memq \'b \'(a b c))', '(memq \'z \'(a b c))', '(memq 1.0 \'(1.0))', '(memql 1.0 \'(1.0))', '(member "b" \'("a" "b"))', '(member \'(1) \'((1) (2)))', '(assq \'b \'((a . 1) (b . 2)))', '(assoc "b" \'(("a" . 1) ("b" . 2)))', '(assoc 2 \'((1 . a) (3 . b)) #\'<)',
  '(rassq 2 \'((a . 1) (b . 2)))', '(rassoc "x" \'((a . "x")))', '(alist-get \'b \'((a . 1) (b . 2)))', '(alist-get \'z \'((a . 1)) \'none)', '(alist-get "b" \'(("b" . 7)) nil nil #\'equal)', '(delq \'a (list \'a \'b \'a \'c))', '(delete 2 (list 1 2 3 2))', '(delete "a" (list "a" "b"))',
  '(remq \'a \'(a b a))', '(remove 1 \'(1 2 1))', '(remove ?a "banana")', '(delete-dups (list 1 2 1 3 2))', '(assq-delete-all \'a (list (cons \'a 1) (cons \'b 2)))',
  '(plist-get \'(a 1 b 2) \'b)', '(plist-get \'(a 1) \'z)', '(plist-put (list \'a 1) \'b 2)', '(plist-put (list \'a 1) \'a 9)', '(plist-member \'(a 1 b 2) \'b)',
  '(let ((l (list 1 2 3))) (setcar l 9) (setcdr (cdr l) nil) l)', '(setcar nil 1)', '(let ((x \'(1 2))) (eq x (append x nil)))', '(proper-list-p \'(1 2))', '(proper-list-p \'(1 . 2))',
  '(consp \'(1))', '(consp nil)', '(atom nil)', '(atom \'(1))', '(listp nil)', '(listp 1)', '(nlistp 1)', '(null nil)', '(null 0)', '(not t)', '(symbolp nil)', '(symbolp \'a)', '(keywordp :a)', '(keywordp \'a)', '(stringp "a")', '(vectorp [1])', '(arrayp "a")', '(sequencep nil)', '(characterp 65)', '(booleanp nil)', '(booleanp 1)', '(functionp \'car)', '(functionp (lambda ()))', '(functionp \'if)', '(functionp \'nope)',
  '(type-of 1)', '(type-of 1.0)', '(type-of "a")', '(type-of \'a)', '(type-of nil)', '(type-of \'(1))', '(type-of [1])', '(type-of (make-hash-table))', '(type-of (expt 2 70))',
  '(let ((l (list 3 1 2))) (sort l #\'<))', '(let ((l (list 3 1 2))) (sort l #\'<) l)', '(sort (list "b" "a" "c") #\'string<)', '(sort [3 1 2] #\'<)', '(sort (list 3 1 2) #\'>)', '(sort (list (cons 1 \'b) (cons 1 \'a) (cons 0 \'c)) (lambda (x y) (< (car x) (car y))))', '(sort nil #\'<)',
  '(mapcar #\'1+ \'(1 2 3))', '(mapcar #\'car \'((1) (2)))', '(mapcar (lambda (x) (* x x)) [1 2 3])', '(mapcar #\'identity "ab")', '(mapc #\'ignore \'(1 2))', '(let ((n 0)) (mapc (lambda (x) (setq n (+ n x))) \'(1 2 3)) n)', '(mapcan (lambda (x) (list x x)) \'(1 2))',
  '(mapconcat #\'symbol-name \'(a b c) ",")', '(mapconcat #\'identity \'("a" "b") "")', '(mapconcat (lambda (x) (format "%d" x)) [1 2 3] "-")', '(mapconcat #\'identity \'("a" "b"))', '(mapcar #\'1+ 5)', '(mapcar #\'car \'(1))',
  '(apply #\'+ \'(1 2 3))', '(apply #\'+ 1 2 \'(3))', '(apply \'list \'())', '(apply #\'max 1 \'(5 2))', '(apply #\'+ 1)', '(funcall #\'+ 1 2)', '(funcall \'list 1 2)', '(funcall (lambda (x y) (+ x y)) 1 2)', '(funcall nil)', '(funcall \'nope)', '(funcall 1)', '(funcall "a")',
  '(add-to-list \'my-list 1)', '(progn (setq my-list2 \'(a)) (add-to-list \'my-list2 \'b) (add-to-list \'my-list2 \'a) my-list2)',

  // ---- seq and cl
  '(seq-filter #\'cl-evenp \'(1 2 3 4))', '(seq-remove #\'cl-evenp \'(1 2 3 4))', '(seq-map #\'1+ [1 2])', '(seq-reduce #\'+ \'(1 2 3) 10)', '(seq-find #\'cl-evenp \'(1 2 3))', '(seq-some #\'cl-evenp \'(1 3))', '(seq-every-p #\'cl-oddp \'(1 3))', '(seq-count #\'cl-evenp \'(1 2 4))',
  '(seq-uniq \'(1 2 1 3))', '(seq-take \'(1 2 3) 2)', '(seq-drop \'(1 2 3) 2)', '(seq-contains-p \'(1 2) 2)', '(seq-position \'(a b c) \'c)', '(seq-min \'(3 1 2))', '(seq-max [3 1 2])', '(seq-subseq \'(1 2 3 4) 1 3)', '(seq-subseq [1 2 3] -2)', '(seq-partition \'(1 2 3 4 5) 2)', '(seq-reverse \'(1 2 3))', '(seq-empty-p nil)', '(seq-first \'(1 2))', '(seq-rest \'(1 2))',
  '(cl-remove-if #\'cl-evenp \'(1 2 3 4))', '(cl-remove-if-not #\'cl-evenp \'(1 2 3 4))', '(cl-find-if #\'cl-evenp \'(1 2 3))', '(cl-some #\'cl-evenp \'(1 3 4))', '(cl-every #\'cl-evenp \'(2 4))', '(cl-reduce #\'+ \'(1 2 3))', '(cl-reduce #\'+ \'(1 2 3) :initial-value 10)', '(cl-reduce #\'+ nil)', '(cl-first \'(1 2))', '(cl-second \'(1 2))', '(cl-position 2 \'(1 2 3))',
  '(cl-remove-duplicates \'(1 2 1 3))', '(cl-subseq [1 2 3 4] 1 3)', '(cl-list* 1 2 \'(3))', '(cl-mapcar #\'+ \'(1 2) \'(10 20))',

  // ---- vectors and hash tables
  '(vector 1 2 3)', '(make-vector 3 0)', '(vconcat [1] \'(2) "a")', '(aref [1 2 3] 1)', '(aref [1 2 3] 5)', '(aref "abc" 1)', '(aref "abc" 3)', '(aref \'(1) 0)', '(let ((v (vector 1 2 3))) (aset v 1 \'x) v)', '(aset [1] 3 0)', '(let ((v (make-vector 2 0))) (fillarray v 7) v)',
  '(let ((h (make-hash-table :test \'equal))) (puthash "a" 1 h) (puthash "b" 2 h) (list (gethash "a" h) (gethash "z" h) (gethash "z" h \'none) (hash-table-count h)))', '(let ((h (make-hash-table))) (puthash 1 \'a h) (puthash 1 \'b h) (list (gethash 1 h) (hash-table-count h)))',
  '(let ((h (make-hash-table))) (puthash \'a 1 h) (puthash \'b 2 h) (hash-table-keys h))', '(let ((h (make-hash-table))) (puthash \'a 1 h) (puthash \'b 2 h) (hash-table-values h))', '(let ((h (make-hash-table)) (r nil)) (puthash \'a 1 h) (puthash \'b 2 h) (maphash (lambda (k v) (push (cons k v) r)) h) (nreverse r))',
  '(let ((h (make-hash-table :test \'equal))) (puthash \'(1 2) \'x h) (gethash (list 1 2) h))', '(let ((h (make-hash-table))) (puthash 1 2 h) (remhash 1 h) (hash-table-count h))', '(let ((h (make-hash-table))) (puthash 1 2 h) (clrhash h) (hash-table-count h))', '(hash-table-p (make-hash-table))', '(gethash 1 nil)',
  '(let ((h (make-hash-table :test \'equal))) (setf (gethash "k" h) 5) (gethash "k" h))',

  // ---- strings
  '(concat "a" "b")', '(concat)', '(concat "a" nil "b")', '(concat "a" \'(98 99))', '(concat "a" [98])', '(concat "a" 1)', '(concat \'a)', '(substring "hello" 1 3)', '(substring "hello" 1)', '(substring "hello" -3)', '(substring "hello" 0 -1)', '(substring "hello" 2 1)', '(substring "abc" 5)', '(substring "abc" 0 9)', '(substring [1 2 3] 1)',
  '(string ?a ?b)', '(string)', '(make-string 3 ?x)', '(char-to-string ?a)', '(string-to-char "abc")', '(string-to-char "")', '(string-to-list "ab")', '(string-to-vector "ab")', '(upcase "abc")', '(downcase "ABC")', '(capitalize "hello world")', '(capitalize "hELLO wORLD")', '(upcase-initials "hello world")', '(upcase ?a)', '(downcase ?A)', '(upcase "straße")', '(upcase 5)',
  '(string= "a" "a")', '(string= "a" \'a)', '(string< "a" "b")', '(string< "b" "a")', '(string> "b" "a")', '(string-equal "a" "A")', '(string-lessp "abc" "abd")', '(string= 1 2)', '(string-prefix-p "he" "hello")', '(string-suffix-p "lo" "hello")', '(string-prefix-p "HE" "hello" t)', '(string-empty-p "")', '(string-search "l" "hello")', '(string-search "z" "hello")', '(string-search "l" "hello" 3)',
  '(string-replace "l" "L" "hello")', '(string-replace "" "x" "abc")', '(string-join \'("a" "b" "c") ", ")', '(string-join \'("a" "b"))', '(string-trim "  hi  ")', '(string-trim-left "  hi  ")', '(string-trim-right "  hi  ")', '(string-trim "xxhixx" "x+" "x+")', '(string-reverse "abc")', '(string-pad "ab" 5)', '(string-pad "ab" 5 ?. t)',
  '(char-equal ?a ?A)', '(let ((case-fold-search nil)) (char-equal ?a ?A))', '(symbol-name \'foo)', '(intern "foo")', '(eq (intern "foo") \'foo)', '(make-symbol "x")', '(eq (make-symbol "x") \'x)', '(symbol-name 1)', '(intern 1)',
  '(split-string "a b  c")', '(split-string "a,b,,c" ",")', '(split-string "a,b,,c" "," t)', '(split-string " a b " " ")', '(split-string " a b " " " t)', '(split-string "abc" "")', '(split-string "" ",")', '(split-string "" "," t)', '(split-string "a, b ,c" "," t " +")', '(split-string "a1b22c" "[0-9]+")', '(split-string "  two words ")', '(split-string "a\\nb\\n" "\\n")', '(split-string "a\\nb\\n" "\\n" t)', '(split-string "abc" "b*")', '(split-string "a--b" "-+")',
  '(string-match "b+" "aabbb")', '(string-match "x" "abc")', '(string-match "B" "abc")', '(let ((case-fold-search nil)) (string-match "B" "abc"))', '(string-match "a\\\\(b\\\\)c" "xabc")', '(progn (string-match "a\\\\(b\\\\)\\\\(c\\\\)?" "xab") (list (match-beginning 0) (match-end 0) (match-beginning 1) (match-end 1) (match-beginning 2) (match-end 2)))',
  '(progn (string-match "\\\\([a-z]+\\\\)-\\\\([0-9]+\\\\)" "x foo-42 y") (list (match-string 0 "x foo-42 y") (match-string 1 "x foo-42 y") (match-string 2 "x foo-42 y")))', '(progn (string-match "b" "abc") (match-data))', '(string-match "^b" "a\\nb")', '(string-match "a$" "a\\nb")', '(string-match "." "\\n")', '(string-match "[[:digit:]]+" "ab123")', '(string-match "[[:alpha:]]+" "12ab")', '(string-match "[[:space:]]" "a b")', '(string-match "[^a-c]" "abcd")',
  '(string-match "\\\\bfoo\\\\b" "a foo b")', '(string-match "\\\\<foo" "xfoo foo")', '(string-match "foo\\\\>" "foox foo")', '(string-match "a\\\\|b" "xb")', '(string-match "a\\\\{2\\\\}" "caab")', '(string-match "a\\\\{2,\\\\}" "caaab")', '(string-match "\\\\(?:ab\\\\)+" "xababy")', '(string-match "a+?" "aaa")', '(string-match "(" "a(b")', '(string-match "a|b" "a|b")', '(string-match "\\\\w+" "  hi")', '(string-match "\\\\W" "ab c")', '(string-match "\\\\s-" "ab c")', '(string-match "\\\\`a" "ab")', '(string-match "b\\\\\'" "ab")', '(string-match "x*" "abc")', '(string-match "*a" "x*a")', '(string-match "\\\\(a\\\\)\\\\1" "xaa")', '(string-match "[" "a")', '(string-match "\\\\(" "a")', '(string-match "b" "abcb" 2)',
  '(string-match-p "b" "abc")', '(progn (string-match "z" "abc") (string-match-p "b" "abc") (match-beginning 0))', '(progn (string-match "b" "abc") (string-match-p "c" "abc") (match-beginning 0))', '(match-string 1)', '(regexp-quote "a.b*c")', '(regexp-quote "[x]^$")',
  '(replace-regexp-in-string "b+" "X" "abbcb")', '(replace-regexp-in-string "\\\\(a\\\\)\\\\(b\\\\)" "\\\\2\\\\1" "abab")', '(replace-regexp-in-string "a" "\\\\&\\\\&" "banana")', '(replace-regexp-in-string "a" "B" "banana")', '(replace-regexp-in-string "A" "b" "banana")', '(replace-regexp-in-string "a" "b" "Banana A")', '(replace-regexp-in-string "[aeiou]" #\'upcase "education")', '(replace-regexp-in-string "x" "y" "")', '(replace-regexp-in-string "^" ">" "a\\nb")', '(replace-regexp-in-string "\\\\s-+" " " "a   b \\t c")', '(replace-regexp-in-string "o" "0" "foo" nil t)', '(replace-regexp-in-string "foo" "bar" "Foo FOO foo")', '(replace-regexp-in-string "foo" "bar" "Foo FOO foo" t)', '(replace-regexp-in-string "\\\\(a\\\\)" "[\\\\1]" "cat" nil nil 1)',
  '(progn (string-match "b" "abc") (replace-match "X" t t "abc"))', '(progn (string-match "\\\\(b\\\\)" "abc") (replace-match "<\\\\1>" t nil "abc"))',

  // ---- special forms and control
  '(quote a)', '\'(1 2)', '#\'car', '(if t 1 2)', '(if nil 1 2)', '(if nil 1)', '(if nil 1 2 3)', '(when t 1 2)', '(when nil 1)', '(unless nil 1 2)', '(unless t 1)', '(and)', '(and 1 2)', '(and 1 nil 2)', '(or)', '(or nil 2 3)', '(or nil nil)',
  '(cond ((= 1 2) \'a) ((= 1 1) \'b))', '(cond (nil 1))', '(cond (5))', '(cond (nil 1) (t))', '(cond (1 2 3))', '(progn)', '(progn 1 2)', '(prog1 1 2)', '(prog2 1 2 3)',
  '(let ((x 1) (y 2)) (+ x y))', '(let ((x 1)) (let ((x 2) (y x)) y))', '(let* ((x 1) (y (+ x 1))) y)', '(let (a b) (list a b))', '(let ((x 1)) (setq x 5) x)', '(let ((x 1)) (setq x 2 y3 3) (list x y3))', '(setq)', '(setq a)', '(setq 1 2)', '(setq nil 1)', '(setq t 1)', '(let ((x)) x)', '(let ((x 1 2)) x)',
  '(progn (setq g1 10) (let ((g1 20)) g1))', '(progn (defvar dyn-v 1) (defun get-dyn-v () dyn-v) (let ((dyn-v 2)) (get-dyn-v)))', '(progn (setq lex-v 1) (defun get-lex-v () lex-v) (let ((lex-v 2)) (get-lex-v)))', '(let ((fl 1)) (defun get-fl () fl) (setq fl 2) (get-fl))',
  '(defvar dv1 5)', '(defvar dv1 6)', 'dv1', '(defconst dc1 7)', 'dc1', '(defvar dv-nodoc)', 'dv-nodoc', '(setq setq-r (setq q1 1 q2 2))',
  '(defun add2 (a b) (+ a b))', '(add2 1 2)', '(add2 1)', '(add2 1 2 3)', '(defun opt (a &optional b) (list a b))', '(opt 1)', '(opt 1 2)', '(opt)', '(opt 1 2 3)', '(defun rst (a &rest r) (list a r))', '(rst 1)', '(rst 1 2 3)', '(defun doc1 () "doc" 5)', '(doc1)', '(defun doc2 () "only")', '(doc2)',
  '(defun fact (n) (if (<= n 1) 1 (* n (fact (1- n)))))', '(fact 5)', '(fact 20)', '(fact 25)', '(defun fib (n) (if (< n 2) n (+ (fib (- n 1)) (fib (- n 2)))))', '(fib 15)', '(defun count-to (n) (let ((i 0) (acc nil)) (while (< i n) (push i acc) (setq i (1+ i))) (nreverse acc)))', '(count-to 5)',
  '(defmacro my-inc (v) (list \'setq v (list \'1+ v)))', '(let ((n 1)) (my-inc n) n)', '(defmacro my-when (c &rest body) `(if ,c (progn ,@body)))', '(my-when t 1 2)', '(my-when nil 1)', '(defmacro swap (a b) `(let ((tmp ,a)) (setq ,a ,b) (setq ,b tmp)))', '(let ((x 1) (y 2)) (swap x y) (list x y))', '(macroexpand \'(my-when a b))', '(macroexpand-1 \'(my-when a b))',
  '(let ((fs nil)) (dotimes (i 3) (push (lambda () i) fs)) (mapcar #\'funcall fs))', '(let ((fs nil)) (dolist (x \'(a b c)) (push (lambda () x) fs)) (mapcar #\'funcall fs))', '(let ((c 0)) (let ((f (lambda () (setq c (1+ c))))) (funcall f) (funcall f) c))',
  '(defun make-counter () (let ((n 0)) (lambda () (setq n (1+ n)))))', '(let ((c (make-counter))) (funcall c) (funcall c) (funcall c))', '(let ((a (make-counter)) (b (make-counter))) (funcall a) (funcall a) (list (funcall a) (funcall b)))',
  '(funcall (lambda (&optional x) x))', '(funcall (lambda (&rest r) r) 1 2)', '((lambda (x) (* x 2)) 4)', '(funcall (lambda (x) x))', '(let ((f #\'+)) (funcall f 1 2))', '(let ((f (lambda (x) (* 2 x)))) (mapcar f \'(1 2)))', '(lambda (x) x)',
  '(let ((r nil)) (dolist (x \'(1 2 3)) (push (* x x) r)) r)', '(let ((s 0)) (dolist (x \'(1 2 3) s) (setq s (+ s x))))', '(dolist (x nil) 1)', '(let ((r nil)) (dotimes (i 4) (push i r)) r)', '(dotimes (i 3 i))', '(dotimes (i 0) 1)', '(dotimes (i -1) 1)', '(dolist (x \'(1 2) x))', '(dolist (x 5) 1)',
  '(let ((i 0)) (while (< i 5) (setq i (1+ i))) i)', '(let ((i 0) (r nil)) (while (< i 3) (push i r) (setq i (1+ i))) r)', '(while nil)', '(let ((i 10)) (while (> i 0) (setq i (- i 3))) i)',
  '(catch \'done (dolist (x \'(1 2 3)) (when (= x 2) (throw \'done x))) \'none)', '(catch \'a (catch \'b (throw \'a 1)) 2)', '(catch \'a (catch \'b (throw \'b 1)) 2)', '(catch \'x 5)', '(throw \'nope 1)', '(catch \'x (throw \'x 1) 2)', '(catch \'x (unwind-protect (throw \'x 1) (setq uw 9)))', '(progn (setq uw 0) (catch \'x (unwind-protect (throw \'x 1) (setq uw 9))) uw)',
  '(unwind-protect 1 2 3)', '(let ((x 0)) (condition-case nil (unwind-protect (error "e") (setq x 5)) (error x)))',
  '(condition-case e (car 1) (error e))', '(condition-case e (car 1) (wrong-type-argument (cdr e)))', '(condition-case e (error "boom %d" 3) (error (error-message-string e)))', '(condition-case e (error "boom") (error (cadr e)))', '(condition-case nil (error "x") (error 1))', '(condition-case e (+ 1 2) (error 0))', '(condition-case e (+ 1 2) (:success (list \'ok e)) (error 0))', '(condition-case e (/ 1 0) (arith-error \'div))', '(condition-case e (/ 1 0) (error e))',
  '(condition-case e (signal \'my-err \'(1 2)) (my-err e))', '(condition-case e (signal \'my-err \'(1 2)) (error e))', '(condition-case e (signal \'my-err \'(1 2)) (t (list \'caught e)))', '(condition-case e (signal \'wrong-type-argument \'(x y)) ((arith-error wrong-type-argument) \'multi))', '(condition-case e (user-error "ue %s" "x") (user-error e))', '(condition-case e (user-error "ue") (error (error-message-string e)))',
  '(condition-case e (throw \'zz 1) (no-catch e))', '(condition-case e foo-unbound (void-variable e))', '(condition-case e (foo-unbound-fn) (void-function e))', '(condition-case e (funcall (lambda (x) x)) (wrong-number-of-arguments (car e)))', '(condition-case e (car 1 2) (wrong-number-of-arguments e))', '(condition-case e (aref [1] 9) (args-out-of-range e))', '(condition-case e (nth 1 5) (error e))',
  '(condition-case e (condition-case e2 (error "inner") (arith-error 1)) (error (cadr e)))', '(condition-case e (condition-case e2 (error "inner") (error (error "outer"))) (error (cadr e)))', '(condition-case err (signal \'quit nil) (quit \'q))', '(condition-case e (read ")") (invalid-read-syntax e))', '(condition-case e (string-to-number 5) (error e))',
  '(ignore-errors (car 1))', '(ignore-errors 5)', '(ignore-errors (error "x") 5)', '(ignore-error wrong-type-argument (car 1))', '(define-error \'my-error "My error")', '(condition-case e (signal \'my-error \'(1)) (my-error (error-message-string e)))', '(condition-case e (signal \'my-error \'(1)) (error (car e)))', '(progn (define-error \'child-error "Child" \'my-error) (condition-case e (signal \'child-error \'(7)) (my-error (list \'parent e))))', '(error-message-string \'(my-error 1 2))', '(error-message-string \'(error "x"))', '(error-message-string \'(error "x" 1))', '(error-message-string \'(wrong-type-argument integerp "a"))', '(error-message-string \'(foo-unknown 1 2))', '(error-message-string \'(foo-unknown))', '(error-message-string \'(error))', '(error-message-string 5)',
  '(error "plain")', '(error "with %s and %d" "str" 42)', '(error "%S" "q")', '(error 5)', '(error)', '(user-error "bad %d" 1)', '(signal \'wrong-type-argument \'(listp 1))', '(signal \'foo \'(1 2))', '(signal \'error \'("a" "b"))', '(signal \'arith-error nil)', '(signal \'args-out-of-range \'("abc" 5))', '(signal \'void-variable \'(zz))', '(signal \'void-function \'(zz))', '(signal \'end-of-file nil)', '(signal \'quit nil)', '(signal \'user-error \'("x"))', '(signal \'wrong-number-of-arguments \'(f 2))', '(signal \'invalid-function \'(1))', '(signal \'setting-constant \'(nil))', '(signal \'no-catch \'(a b))', '(signal \'cl-assertion-failed \'(x))', '(signal \'overflow-error nil)', '(signal \'search-failed \'("x"))', '(signal \'invalid-regexp \'("bad"))', '(signal \'text-read-only nil)', '(signal \'beginning-of-buffer nil)', '(signal \'scan-error \'("x" 1 2))',
  'undefined-var', '(undefined-fn 1)', '(1 2)', '("a" 1)', '(setq nil 5)', '(set \'nil 5)', '(let ((nil 1)) 1)', '(let ((t 1)) 1)', '(setq :k 1)', '(funcall (lambda (x) x) 1 2)', '(funcall \'car)', '(car)', '(cons 1)', '(list . 1)', '(let)', '(if)', '(quote)',

  // ---- setf, push, pop, incf
  '(let ((l nil)) (push 1 l) (push 2 l) l)', '(let ((l (list 1 2))) (pop l))', '(let ((l (list 1 2))) (pop l) l)', '(let ((l nil)) (pop l))', '(let ((l (list 1 2 3))) (setf (car l) 9) l)', '(let ((l (list 1 2 3))) (setf (nth 1 l) 9) l)', '(let ((l (list 1 2 3))) (setf (cdr l) nil) l)', '(let ((v (vector 1 2))) (setf (aref v 0) 5) v)', '(let ((a (list 1 2))) (push 0 (cdr a)) a)', '(let ((x 1)) (setf x 2) x)', '(let ((x 1)) (setf x 2 x (+ x 10)) x)',
  '(let ((al (list (cons \'a 1)))) (setf (alist-get \'b al) 2) al)', '(let ((al (list (cons \'a 1)))) (setf (alist-get \'a al) 5) al)', '(let ((x 5)) (cl-incf x) x)', '(let ((x 5)) (cl-incf x 3) x)', '(let ((x 5)) (cl-decf x) x)', '(let ((x 5.0)) (cl-incf x) x)', '(let ((l (list 1 2))) (cl-incf (car l) 10) l)', '(let ((p (list 1 2))) (setf (cadr p) 7) p)', '(let ((x 1)) (setf (symbol-value \'g-sv) 4) g-sv)', '(progn (put \'psym \'prop 5) (get \'psym \'prop))', '(progn (setf (get \'psym2 \'k) 8) (get \'psym2 \'k))',
  '(if-let ((a 1) (b 2)) (+ a b) \'no)', '(if-let ((a nil)) a \'no)', '(if-let ((a 1) (b nil)) (+ a b) \'no)', '(when-let ((a 5)) (* a 2))', '(when-let ((a nil)) 1)', '(and-let* ((a 1) (b (+ a 1))) (* b 10))', '(if-let (a 3) a \'no)', '(when-let* ((x (assq \'b \'((a . 1) (b . 2))))) (cdr x))',

  // ---- backquote
  '`(1 2 3)', '`(a ,(+ 1 2))', '`(a ,@(list 1 2) b)', '`(,@(list 1 2))', '`(a . ,(+ 1 1))', '`[1 ,(+ 1 1)]', '`(1 `(2 ,(3 ,(+ 1 3))))', '(let ((x 5)) `(x ,x))', '`(,@nil a)', '`(a ,@nil)', '(let ((l \'(1 2))) `(0 ,@l 3))', '(let ((l \'(1 2))) (eq l (cdr `(0 ,@l))))', '`,(+ 1 2)', '`a', '`(a . b)',

  // ---- eval, read, symbols
  '(eval \'(+ 1 2))', '(eval \'(+ 1 2) t)', '(eval (list \'+ 1 2))', '(eval \'(let ((x 1)) x) t)', '(read "(1 2 . 3)")', '(read "foo")', '(read "\\"s\\"")', '(read "?a")', '(read "1.5")', '(read "[1 2]")', '(read "\'a")', '(read "#\'f")', '(read "`(a ,b ,@c)")', '(read "(a) (b)")', '(read-from-string "(a b) c")', '(read-from-string "abc def" 4)', '(read-from-string "  x")', '(car (read-from-string "1e3"))', '(read "(1 . )")', '(read "( . 1)")', '(read "#")', '(read "a\\\\ b")',
  '(boundp \'dv1)', '(boundp \'never-bound-xyz)', '(fboundp \'car)', '(fboundp \'never-fn-xyz)', '(fboundp \'if)', '(symbol-value \'dv1)', '(symbol-value \'never-bound-xyz)', '(symbol-function \'never-fn-xyz)', '(progn (fset \'my-f (lambda (x) (* x 3))) (my-f 4))', '(progn (defalias \'my-g #\'car) (my-g \'(7 8)))', '(progn (set \'sv1 3) sv1)', '(func-arity \'car)', '(func-arity (lambda (a &optional b) a))', '(func-arity (lambda (a &rest b) a))', '(func-arity \'if)',
  '(identity 5)', '(ignore 1 2)', '(always 1)', 'nil', 't', ':kw', '(eq nil \'())', '(eq \'a \'a)', '(eq "a" "a")', '(equal "a" "a")', '(equal \'(1 (2)) \'(1 (2)))', '(equal [1 2] [1 2])', '(equal 1 1)', '(eq \'(1) \'(1))', '(eql 5 5)', '(equal "a" \'a)',
  '(prin1-to-string (read "(a . (b . (c)))"))', '(featurep \'cl-lib)', '(require \'cl-lib)', '(provide \'x)',
  '(let ((print-length nil)) (format "%S" \'(1 2)))', '(car (cdr (cdr \'(1 2 3))))', '(let ((x \'(a b c))) (list (car x) (cadr x) (caddr x)))', '(mapcar (lambda (p) (car p)) \'((a . 1) (b . 2)))',
  '(let ((alist \'((a . 1) (b . 2) (c . 3))) (sum 0)) (dolist (p alist) (setq sum (+ sum (cdr p)))) sum)', '(let ((s "")) (dolist (w \'("a" "b" "c")) (setq s (concat s w "-"))) s)', '(mapconcat (lambda (n) (number-to-string (* n n))) \'(1 2 3) " ")', '(let ((str "hello world")) (string-match "o w" str) (substring str (match-beginning 0) (match-end 0)))',
  '(let ((acc nil)) (dotimes (i 3) (dotimes (j 2) (push (cons i j) acc))) (nreverse acc))', '(let ((x 10)) (cond ((< x 5) \'small) ((< x 20) \'medium) (t \'large)))', '(let ((v [1 2 3]) (s 0)) (dotimes (i (length v)) (setq s (+ s (aref v i)))) s)',
  '(let ((fib nil)) (setq fib (lambda (n) (if (< n 2) n (+ (funcall fib (- n 1)) (funcall fib (- n 2)))))) (funcall fib 10))', '(let ((compose (lambda (f g) (lambda (x) (funcall f (funcall g x)))))) (funcall (funcall compose #\'1+ #\'(lambda (x) (* x 2))) 5))',
  '(format "%s" (list 1.0 2.5 "x" ?a))', '(format "%s|%S" "a\\nb" "a\\nb")', '(format "%-10s|%5s|" "left" "right")', '(format "%s" (format "%03d" 7))', '(let ((n 3)) (format "%d item%s" n (if (= n 1) "" "s")))',

  // ---- depth and runaway programs
  '(progn (defun deep (n) (if (= n 0) 0 (1+ (deep (1- n))))) (deep 100))', '(deep 500)', '(condition-case e (deep 10000) (error e))', '(condition-case e (deep 100000) (excessive-lisp-nesting (car e)))',
  '(progn (defun forever () (forever)) (condition-case e (forever) (error (car e))))', '(let ((max-lisp-eval-depth 200)) (condition-case e (deep 100) (error e)))',
  '(let ((max-lisp-eval-depth 400)) (deep 100))',

  ...[505, 510, 515, 518, 520, 522, 524, 526, 528, 529, 530, 531, 532, 533, 534, 536, 540].map((n) => `(condition-case e (deep ${n}) (error (car e)))`),
  ...[505, 515, 520, 525, 528, 530, 532, 534, 540].map((n) => ({ src: `(condition-case e (deep ${n}) (error (car e)))`, lexical: false })),
  '(let ((max-lisp-eval-depth 300)) (condition-case e (deep 90) (error (car e))))', '(let ((max-lisp-eval-depth 300)) (condition-case e (deep 95) (error e)))',

  // ---- dynamic binding (plain `eval`)
  { src: '(let ((x 1)) (funcall (lambda () x)))', lexical: false },
  { src: '(let ((x 1)) (defun dyn-get () x) (let ((x 2)) (dyn-get)))', lexical: false },
  { src: '(defun dyn-add (a b) (+ a b)) (dyn-add 1 2)', lexical: false },
  { src: '(setq dx 5) (let ((dx 6)) (symbol-value \'dx))', lexical: false },
  { src: '(let ((f (lambda (x) (* x 2)))) (funcall f 4))', lexical: false },
  { src: '(let ((n 10)) (let ((f (lambda () n))) (let ((n 20)) (funcall f))))', lexical: false },
  { src: '(lambda (x) x)', lexical: false },
  { src: '(funcall (lambda (x) x))', lexical: false },
  { src: '(defun dyn-opt (a &optional b) (list a b)) (dyn-opt 1 2 3)', lexical: false },
  { src: '(let ((r nil)) (dotimes (i 3) (push i r)) r)', lexical: false },
  { src: '(let ((r nil)) (dolist (x \'(a b)) (push x r)) r)', lexical: false },
  { src: '(let* ((a 1) (b (+ a 1))) (list a b))', lexical: false },
  { src: '(condition-case e (error "dyn") (error (cadr e)))', lexical: false },
  { src: '(let ((fs nil)) (dotimes (i 3) (push (lambda () i) fs)) (condition-case e (mapcar (function funcall) fs) (error (car e))))', lexical: false },
  { src: '(defun dyn-fact (n) (if (<= n 1) 1 (* n (dyn-fact (1- n))))) (dyn-fact 10)', lexical: false },
  { src: '(setq lst nil) (push 1 lst) (push 2 lst) lst', lexical: false },
  { src: '(if-let ((a 1)) (+ a 1) 0)', lexical: false },
  { src: '(deep 500)', lexical: false },
];

// ---- generated matrices ---------------------------------------------------------------------------
/** A Lisp string literal for `t`. @param {string} t */
const lisp = (t) => `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;

const floats = ['0.1', '0.5', '1.5', '2.5', '-2.5', '100.0', '1e5', '1e14', '123456.789', '0.000123', '1e-7', '3.14159265358979', '2.718281828459045', '1e21', '123456789.123456789', '5e-324', '1.7976931348623157e308', '-0.5', '0.30000000000000004', '1e22', '4.35', '1.005', '0.125', '99.995'];
for (const x of floats) CASES.push(`(format "%s" ${x})`, `(format "%.2f" ${x})`, `(format "%e" ${x})`, `(format "%g" ${x})`, `(format "%.0f" ${x})`, `(round ${x})`, `(truncate ${x})`, `(format "%10.3f|" ${x})`, `(* ${x} 3)`, `(/ ${x} 7)`);

const specs = ['%d', '%5d', '%-5d|', '%05d', '%+d', '% d', '%x', '%#x', '%o', '%X', '%.3d', '%+5d', '%-+5d|', '%c'];
for (const sp of specs) for (const v of ['0', '7', '-7', '42', '255', '65', '123456789']) CASES.push(`(format "${sp}" ${v})`);

const sspecs = ['%s', '%5s|', '%-5s|', '%.1s', '%5.1s|', '%S', '%-8S|', '%.3S'];
for (const sp of sspecs) for (const v of ['"abc"', '"abcdefgh"', "'sym", '12', '1.5', '\'(1 "b" c)', 'nil', '"é"', '[1 "x"]']) CASES.push(`(format "${sp}" ${v})`);

const pats = ['a', 'a*', 'a+', 'a?', 'ab*c', '\\(a\\|b\\)+', '\\(a\\)\\(b\\)?', '[a-c]+', '[^a-c]+', '[[:upper:]]+', '[[:punct:]]', '[[:alnum:]_]+', '^a', 'c$', '\\bw', '\\Bw', 'w\\b', '.*', 'a.c', '\\.', '[.]', '[]a]', '[a-]', '\\(?:a\\|b\\)c', 'a\\{1,2\\}', 'x\\{0\\}', '\\s-+', '\\S-+', '\\w+', '\\W+', '[0-9]+\\.?[0-9]*', '\\(\\w+\\) \\1', 'A', 'a\\|', '\\|a', '+a', 'a**', 'a*?', '[[:space:]]*$'];
const subjects = ['abc', 'aabbcc', 'Hello World', 'x=1.25', '', 'a\nb', 'foo foo', 'ABC abc', '  pad  ', 'a.b', 'wow w'];
for (const pt of pats) for (const sj of subjects) CASES.push(`(condition-case e (list (string-match ${lisp(pt)} ${lisp(sj)}) (match-data)) (error (list 'err (error-message-string e))))`);

const seps = [null, ',', ' ', '[, ]+', '\\s-+', '', 'b*', '\n', '[0-9]'];
const texts = ['a,b,,c', ' a  b ', 'a, b ,c', '', ',', 'abc', 'a1b22c', 'x\ny\n', '  '];
for (const sp of seps) for (const tx of texts) for (const extra of sp === '' || sp === 'b*' ? ['', ' t'] : ['', ' t', ' nil " +"', ' t " +"']) CASES.push(`(split-string ${lisp(tx)} ${sp === null ? 'nil' : lisp(sp)}${extra})`);

const reps = [['a', 'X'], ['\\(a\\)\\(b\\)', '\\2\\1'], ['b*', '-'], ['^', '> '], ['$', '!'], ['\\<', '<'], ['[aeiou]', '\\&\\&'], ['x', '\\\\'], ['a', 'b']];
const rsubj = ['banana', 'abab', 'Hello world', '', 'a\nb', 'AAA aaa Aaa'];
for (const [re, rp] of reps) for (const sj of rsubj) for (const extra of ['', ' t', ' nil t']) CASES.push(`(condition-case e (replace-regexp-in-string ${lisp(re)} ${lisp(rp)} ${lisp(sj)}${extra}) (error (list 'err (error-message-string e))))`);

// ---- Emacs's regexp failure stack: a loop that goes on long enough signals "Stack overflow in regexp matcher"
// (src/regex-guard.js checkFailureStack). Each shape is tried on both sides of the length where Emacs 29.3 overflows (measured:
// 88,888 to 266,665 repeated units), at a margin of about 15%, with a last character so the cases below the boundary match at once.
/** @type {[string, string, string, number, number][]} pattern, repeated unit, last text, shorter, longer */
const stackCases = [
  ['\\(a\\|b\\)*c', 'a', 'c', 75000, 100000],
  ['\\(a\\|b\\)*c', 'b', 'c', 112000, 152000],
  ['\\(?:a\\|b\\)*c', 'a', 'c', 112000, 152000],
  ['\\(?:a\\|b\\)*c', 'b', 'c', 226000, 306000],
  ['\\(a\\|b\\|c\\)*d', 'a', 'd', 75000, 100000],
  ['\\(a\\)*c', 'a', 'c', 112000, 152000],
  ['\\(.\\)*c', 'a', 'c', 112000, 152000],
  ['\\([ab]\\)*c', 'a', 'c', 112000, 152000],
  ['\\(ab\\)*c', 'ab', 'c', 112000, 152000],
  ['\\(?:ab\\|cd\\)*e', 'ab', 'e', 112000, 152000],
  ['\\(a\\|b\\)+c', 'a', 'c', 75000, 100000],
  ['\\(?:a*b\\)*c', 'ab', 'c', 226000, 306000],
  ['x*\\(a\\|b\\)*c', 'a', 'c', 75000, 100000],
  ['\\(a\\|\\)*c', 'a', 'c', 75000, 100000],
  // one character at a time: only when what follows could match that character
  ['.*c', 'a', 'c', 226000, 306000],
  ['\\(?:.\\)*c', 'a', 'c', 226000, 306000],
  ['[ab]*a', 'a', 'a', 226000, 306000],
  ['a*a', 'a', 'a', 226000, 306000],
  ['a*\\(a\\|b\\)*c', 'a', 'c', 226000, 306000],
  // never overflow
  ['[ab]*c', 'a', 'c', 300000, 400000],
  ['\\(?:a\\)*c', 'a', 'c', 300000, 400000],
  ['\\(?:ab\\)*c', 'ab', 'c', 200000, 300000],
];
for (const [re, unit, last, shorter, longer] of stackCases) {
  for (const n of [shorter, longer]) {
    CASES.push(`(condition-case e (string-match ${JSON.stringify(re)} (concat (apply #'concat (make-list ${n} ${JSON.stringify(unit)})) ${JSON.stringify(last)})) (error (cadr e)))`);
  }
}
CASES.push(
  // the example that stalled: no "c" at all, so every start position would run to the end
  '(condition-case e (string-match "\\\\(a\\\\|b\\\\)*c" (make-string 100000 ?a)) (error (cadr e)))',
  '(condition-case e (string-match "\\\\(a\\\\|b\\\\)*c" (concat (make-string 10 ?x) (make-string 100000 ?a))) (error (cadr e)))',
  '(condition-case e (string-match "\\\\(a\\\\|b\\\\)*c" (make-string 100000 ?x)) (error (cadr e)))',
  '(condition-case e (string-match "\\\\(a\\\\|b\\\\)*" (make-string 100000 ?a)) (error (cadr e)))',
  '(condition-case e (string-match "\\\\(a\\\\|b\\\\)*" (make-string 100000 ?b)) (error (cadr e)))',
  '(condition-case e (string-match "\\\\(a\\\\|b\\\\)*c" (make-string 30000 ?a)) (error (cadr e)))',
  '(condition-case e (string-match "\\\\(a\\\\|b\\\\)*" (make-string 100000 ?a) 50000) (error (cadr e)))',
  '(condition-case e (string-match "\\\\(a\\\\|b\\\\)*" (make-string 100000 ?a) 20000) (error (cadr e)))',
  '(condition-case e (string-match "x*\\\\(a\\\\|b\\\\)*" (make-string 100000 ?a)) (error (cadr e)))',
  '(condition-case e (string-match "[ab]*c" (make-string 400000 ?a)) (error (cadr e)))',
);

// ---- huge or invalid sizes: the error Emacs 29.3 signals (a size past memory is "Memory exhausted")
for (const form of ["(make-string most-positive-fixnum ?a)", "(make-string 1000000000000 ?a)",  "(make-string -1 ?a)", "(make-string 1.5 ?a)", "(make-string 'a ?a)", "(make-string 3 \"a\")", "(make-string 3 -1)", "(make-string most-negative-fixnum ?a)", "(make-string 0 ?a)", "(make-string 3 ?a t)", "(make-list most-negative-fixnum 0)", "(make-list -1 0)", "(make-list 1.5 0)", "(make-list 'a 0)", "(make-list 0 1)", "(make-vector most-positive-fixnum 0)", "(make-vector 1000000000000 0)", "(make-vector -1 0)", "(make-vector 1.5 0)", "(make-vector 'a 0)", "(make-vector 0 1)",      "(make-hash-table :size -1)", "(make-hash-table :size 1.5)", "(make-hash-table :size 'a)",  "(hash-table-p (make-hash-table :size 10))", "(expt 2 100000000)", "(expt 2 -1)", "(ash 1 100000000)", "(ash 1 -100000)", "(ash 1 1.5)", "(ash 1 most-positive-fixnum)", "(expt 2 'a)", "(expt 2.0 100000)", "(expt 0 -1)"]) {
  CASES.push(`(condition-case e ${form} (error (list (car e) (if (stringp (cadr e)) (substring (cadr e) 0 20) (cadr e)) (cddr e))))`);
}

// ---- bool-vectors: construction, printing and reading (#&LENGTH"BYTES"), the bool-vector-* functions, and the generic sequence
// functions on them. The cases show a value through `bv-show`, which prints control characters as ^A..., because the oracle
// driver's records use the bytes 1 to 4 as separators.
CASES.push(
  '(defun bv-show (v) (replace-regexp-in-string "[\\0-\\37\\177]" (lambda (m) (string ?^ (logxor (aref m 0) 64))) (prin1-to-string v)))',
  '(defun bv-make (n k) (let ((b (make-bool-vector n nil))) (dotimes (i n) (aset b i (= 1 (% (+ (* i i) (* k i)) 3)))) b))',
);
/** A case that shows the value of `form`, or the error it signals. @param {string} form */
const bvShow = (form) => `(condition-case e (bv-show ${form}) (error (bv-show e)))`;
for (let n = 0; n <= 20; n++) {
  for (const k of [0, 1, 2]) CASES.push(bvShow(`(bv-make ${n} ${k})`));
  CASES.push(bvShow(`(make-bool-vector ${n} t)`), bvShow(`(make-bool-vector ${n} nil)`));
  // the exact characters of the printed form, for prin1 and for princ
  CASES.push(`(append (prin1-to-string (bv-make ${n} 1)) nil)`, `(append (with-output-to-string (princ (bv-make ${n} 2))) nil)`);
  CASES.push(bvShow(`(with-output-to-string (princ (bv-make ${n} 1)))`), `(equal (read (prin1-to-string (bv-make ${n} 0))) (bv-make ${n} 0))`, `(equal (read (prin1-to-string (bv-make ${n} 1))) (bv-make ${n} 1))`, `(equal (read (prin1-to-string (make-bool-vector ${n} t))) (make-bool-vector ${n} t))`);
}
/** A case that reads `text` and shows the object, or the error's symbol and data. @param {string} text */
const bvRead = (text) => `(condition-case e (bv-show (read ${JSON.stringify(text)})) (error (list (car e) (if (eq (car e) 'end-of-file) nil (cdr e)))))`;
for (const text of [
  '#&5"\\31"', '#&3"\\5"', '#&0""', '#&5""', '#&5"\\31\\31"', '#&5"\\377"', '#&5a', '#&', '#&-1""', '#&5 "a"', '#&8"a"', '#&9"ab"', '#&2"\\377"', '#&2"\\3"',
  '#&10"\\377\\3"', '#&10"\\377\\377"', '#&3"\\xff"', '#&16"\\x0\\x80"', '#&8"é"', '#&8"\\^A"', '#&8"\\C-a"', '#&8"\\n"', '#&8"\\\\"', '#&8"\\""', '#&01"\\1"', '#&1.0"\\1"',
  '#&1e0"\\1"', '#&#x10"\\1"', '#&+1"\\1"', "'#&1\"\\1\"", '#&8"a\\0"', '#&8""', '#&16"ab\\0"', '#&15"ab\\0"', '#&7"ab"', '#& 8"a"', '#&8', '#&8 ', '#&99999999999999999999"a"',
  '#&"a"', '#&1"\\1"x', '#&3"\\u0001"', '#&3"\\x1"', '#&3"\\x100"', '#&8"\\200"', '#&1"\\s"', '#&1"\\^?"', '#&9"\\^?\\^?"', '#&1"\\0"', '#&1"\\18"', '#&24"\\1\\12\\123"',
  '#&24"\\60\\61\\62"', '#&16"\\3 "', '#&16"\\3a"', '(#&2"\\3" . #&1"\\0")', '(#&2"\\3"#&1"\\0")', '[#&2"\\3"#&1"\\0"]', '#&2"\\3"#&1"\\0"', '#&2"\\3"abc', '#&2"\\3', '#&2"', '#&2"\\',
  '#&2"\\3""', '`(a #&2"\\3" ,(+ 1 2))', '(quote #&2"\\3")', '#&1"\\1" ', '#&18"\\377\\377\\3"', '#&17"\\377\\377\\1"', '#&20"\\266m\\13"',
]) CASES.push(bvRead(text));
CASES.push(
  // evaluating a bool-vector literal gives itself, and a literal is one object
  bvShow('#&2"\\3"'), bvShow("'#&2\"\\3\""), bvShow('(let ((b (read "#&1\\"\\\\1\\""))) (aset b 0 nil) b)'), '(eq (read "#&1\\"\\\\1\\"") (read "#&1\\"\\\\1\\""))',
  bvShow('(car (read-from-string "#&2\\"\\\\3\\""))'), '(cdr (read-from-string "#&2\\"\\\\3\\""))', bvShow('(read-from-string "(#&2\\"\\\\3\\" . #&1\\"\\\\0\\")")'),
  bvShow('(equal #&2"\\3" (bool-vector t t))'), '(type-of (read "#&2\\"\\\\3\\""))',
);

// construction, predicates and the type
const bvForms = [
  '(make-bool-vector 5 t)', '(make-bool-vector 0 t)', '(make-bool-vector 3 \'x)', '(make-bool-vector 3 nil)', '(length (make-bool-vector 134217728 nil))', '(aref (make-bool-vector 134217728 t) 134217727)', '(bool-vector-count-population (make-bool-vector 134217728 t))',
  '(bool-vector t nil t)', '(bool-vector)', '(bool-vector 1 2)', '(bool-vector 1)', '(apply #\'bool-vector \'(t nil))', '(bool-vector t t t t t t t t t t)',
  '(bool-vector-p (bool-vector))', '(bool-vector-p [t])', '(bool-vector-p nil)', '(bool-vector-p "a")', '(vectorp (bool-vector))', '(arrayp (bool-vector))', '(sequencep (bool-vector))',
  '(stringp (bool-vector))', '(listp (bool-vector))', '(atom (bool-vector))', '(consp (bool-vector))', '(functionp (bool-vector))', '(type-of (bool-vector))', '(type-of [t])',
  "(cl-typep (bool-vector) 'bool-vector)", "(cl-typep (bool-vector) 'array)", "(cl-typep (bool-vector t) 'sequence)", "(cl-typep (bool-vector) 'vector)", "(cl-typep (bool-vector) 'atom)",
  "(cl-typep (bool-vector) 'list)", "(cl-typep (bool-vector) 'string)", "(cl-typep (bool-vector) 'integer)", "(cl-typep (bool-vector) '(or string bool-vector))", "(cl-typep [t] 'bool-vector)", "(cl-typep nil 'bool-vector)",
  // sizes and arguments
  '(make-bool-vector -1 t)', '(make-bool-vector 1.5 t)', "(make-bool-vector 'a t)", '(make-bool-vector "3" t)', '(make-bool-vector nil t)', '(make-bool-vector (expt 2 70) t)', '(make-bool-vector (- (expt 2 70)) t)',
  '(make-bool-vector most-negative-fixnum t)', '(make-bool-vector (1+ most-positive-fixnum) t)', '(make-bool-vector 3)', '(make-bool-vector 3 t t)', '(bool-vector-p)',
  // aref, aset, elt, length
  '(aref (bool-vector t nil) 0)', '(aref (bool-vector t nil) 1)', '(aref (bool-vector t nil) 2)', '(aref (bool-vector t nil) -1)', '(aref (bool-vector t nil) 1.0)', "(aref (bool-vector t) 'a)", '(aref (bool-vector t) nil)',
  '(aref (bool-vector) 0)', '(aref [1 2] 1.0)', '(aref [1 2] nil)', '(aset [1 2] 1.0 t)', '(aset [1 2] \'a t)', '(aref 5 0)', '(aset 5 0 t)',
  "(let ((b (bool-vector t nil))) (aset b 1 'foo) b)", "(let ((b (bool-vector t nil))) (list (aset b 1 'foo) b))", '(let ((b (bool-vector t nil))) (aset b 1 nil) b)', '(let ((b (bool-vector t nil))) (aset b 2 t) b)',
  '(let ((b (bool-vector t nil))) (aset b -1 t) b)', '(aset (bool-vector t) 0.0 t)', '(aset (bool-vector t) nil t)', '(aset (bool-vector) 0 t)', '(let ((b (make-bool-vector 20 nil))) (aset b 19 t) (aset b 8 t) b)',
  '(elt (bool-vector t nil) 1)', '(elt (bool-vector t nil) 5)', '(elt (bool-vector t) -1)', '(elt (bool-vector t) 1.0)', "(elt (bool-vector t) 'a)",
  '(length (bool-vector t nil t))', '(length (bool-vector))', '(length (make-bool-vector 17 t))', '(length= (bool-vector t nil) 2)', '(length< (bool-vector t) 2)', '(safe-length (bool-vector t))',
  // copy, equality
  '(copy-sequence (bool-vector t nil t))', '(copy-sequence (bool-vector))', '(let* ((a (bool-vector t nil)) (b (copy-sequence a))) (aset b 0 nil) (list a b (eq a b)))',
  '(equal (bool-vector t nil) (bool-vector t nil))', '(equal (bool-vector t nil) (bool-vector t nil t))', '(equal (bool-vector t nil) [t nil])', '(equal (bool-vector) "")', '(equal (bool-vector) [])',
  '(equal (bool-vector) (bool-vector))', '(equal (bool-vector t) (bool-vector nil))', '(equal (make-bool-vector 9 t) (make-bool-vector 9 t))', '(eq (bool-vector) (bool-vector))', '(eql (bool-vector t) (bool-vector t))',
  '(let ((a (bool-vector t))) (eq a a))', '(equal (list (bool-vector t nil)) (list (bool-vector t nil)))', '(equal (vector (bool-vector t nil)) (vector (bool-vector t nil)))',
  '(member (bool-vector t) (list (bool-vector t)))', '(assoc (bool-vector t) (list (cons (bool-vector t) 1)))', '(memq (bool-vector t) (list (bool-vector t)))', '(delete-dups (list (bool-vector t) (bool-vector t)))',
  '(identity (bool-vector t))', '(let ((v (vector 1 2))) (aset v 0 (bool-vector t)) v)', '(vconcat (list (bool-vector t)))', '(list (bool-vector t) (vector (bool-vector nil)) (cons (bool-vector t nil) 1))',
  // lists, vectors, strings
  '(append (bool-vector t nil) nil)', "(append (bool-vector t nil) '(1))", '(append (bool-vector) nil)', '(append (make-bool-vector 9 t) nil)', '(append (bool-vector t) (bool-vector nil) nil)', '(append (bool-vector t) (bool-vector nil))',
  '(append nil (bool-vector t))', "(append '(1) (bool-vector t))", '(append (bool-vector t nil) "ab")', '(append [1] (bool-vector t))', '(vconcat (bool-vector t nil) [1] "a")', '(vconcat (bool-vector))',
  '(vconcat (make-bool-vector 9 t))', '(vconcat (bool-vector t) (bool-vector nil))', '(concat (bool-vector t nil))', '(string (bool-vector t))', '(substring (bool-vector t nil) 0)', '(number-to-string (bool-vector t))',
  '(symbol-name (bool-vector t))', '(string= (bool-vector) "")', '(car (bool-vector t))', '(cdr (bool-vector t))', '(nth 0 (bool-vector t))', '(nthcdr 1 (bool-vector t))', '(delete t (bool-vector t nil))',
  '(remove t (bool-vector t nil))', '(member t (bool-vector t nil))', '(take 1 (bool-vector t nil))', '(last (bool-vector t))', '(apply #\'+ (bool-vector))', "(apply #'list (bool-vector t))", '(funcall (bool-vector t))',
  '(flatten-tree (bool-vector t))', '(flatten-tree (list (bool-vector t)))', '(string-to-list (bool-vector t))', '(string-to-vector (bool-vector t))', '(string-to-list 5)',
  '(format "%s" (bool-vector t nil))', '(format "%S" (bool-vector t nil))', '(format "%s" (read "#&16\\"\\\\200\\\\1\\""))', '(format "%d" (bool-vector t))', '(prin1-to-string (bool-vector t nil))',
  '(prin1-to-string (list (bool-vector t) 1))', '(prin1-to-string (read "#&16\\"\\\\377\\\\60\\""))', '(prin1-to-string (read "#&16\\"\\\\200\\\\61\\""))', '(prin1-to-string (read "#&8\\"\\\\177\\""))', '(prin1-to-string (read "#&8\\"\\\\\\"\\""))',
  '(prin1-to-string (read "#&8\\"\\\\\\\\\\""))', '(with-output-to-string (princ (read "#&16\\"\\\\200\\\\1\\"")))', '(with-output-to-string (print (bool-vector t)))', '(with-output-to-string (prin1 (list (bool-vector t nil) "s")))',
  '(error-message-string (list \'error (bool-vector t)))', '(condition-case e (aref (bool-vector t) 3) (error e))', 
  // reverse, nreverse, fillarray, sort
  '(reverse (bool-vector t nil nil))', '(reverse (bool-vector))', '(reverse (let ((b (make-bool-vector 10 nil))) (aset b 0 t) b))', '(let ((b (bool-vector t nil nil))) (list (reverse b) b))',
  '(nreverse (bool-vector t nil nil))', '(nreverse (bool-vector))', '(nreverse (let ((b (make-bool-vector 10 nil))) (aset b 0 t) b))', '(let ((b (bool-vector t nil nil))) (list (nreverse b) b))', '(nreverse 5)', '(reverse 5)',
  '(fillarray (make-bool-vector 3 nil) t)', '(fillarray (make-bool-vector 3 t) nil)', '(fillarray (make-bool-vector 3 t) 5)', '(fillarray (bool-vector) t)', '(fillarray (make-bool-vector 20 nil) t)',
  '(fillarray (make-bool-vector 9 nil) t)', '(fillarray (make-bool-vector 9 t) nil)', "(fillarray (bool-vector t) 'x)", '(fillarray (list 1) 0)', '(fillarray (make-bool-vector 3 nil))', '(fillarray 5 t)',
  '(sort (bool-vector t nil t) (lambda (a b) (and a (not b))))', '(sort (bool-vector t nil t) #\'<)', '(sort (bool-vector t nil))',
  // mapping
  "(mapcar #'identity (bool-vector t nil t))", '(mapcar (lambda (x) (if x 1 0)) (bool-vector t nil t))', "(mapcar #'identity (bool-vector))", '(let (r) (mapc (lambda (x) (push x r)) (bool-vector t nil)) r)',
  '(mapc #\'ignore (bool-vector t))', '(mapconcat (lambda (x) (if x "1" "0")) (bool-vector t nil t) ",")', '(mapconcat (lambda (x) (if x "a" "b")) (bool-vector t nil))', "(mapconcat #'identity (bool-vector) \",\")",
  '(mapcan (lambda (x) (list x)) (bool-vector t nil))', "(mapcar #'identity 5)",
  // seq functions
  "(seq-map #'identity (bool-vector t nil))", "(seq-filter #'identity (bool-vector t nil t))", "(seq-remove #'not (bool-vector t nil nil))", '(seq-reduce (lambda (a x) (+ a (if x 1 0))) (bool-vector t nil t) 0)', "(seq-reduce #'+ (bool-vector) 0)",
  '(seq-length (bool-vector t nil))', '(seq-length (make-bool-vector 17 t))', '(seq-elt (bool-vector t nil) 0)', '(seq-elt (bool-vector t nil) 9)', '(seq-elt (bool-vector t) 1)', '(seq-reverse (bool-vector t nil nil))',
  '(seq-reverse (make-bool-vector 9 t))', '(seq-subseq (bool-vector t nil nil) 1)', '(seq-subseq (bool-vector) 0)', '(seq-take (bool-vector t nil nil) 1)', '(seq-take (bool-vector) 0)', '(seq-drop (bool-vector t nil nil) 1)',
  '(seq-drop (bool-vector) 0)', '(seq-drop (bool-vector t) 0)', '(seq-rest (bool-vector t nil))', '(seq-rest (bool-vector))', '(seq-uniq (bool-vector t nil nil))', '(seq-uniq (bool-vector t t))', "(seq-count #'identity (bool-vector t nil t))",
  "(seq-count #'not (bool-vector t nil nil))", "(seq-into (bool-vector t nil) 'list)", "(seq-into (bool-vector t nil) 'vector)", "(seq-into (bool-vector) 'string)", "(seq-into '(t nil) 'bool-vector)", "(seq-into (bool-vector) 'bool-vector)",
  "(seq-into (bool-vector t) 'array)", "(seq-concatenate 'vector (bool-vector t nil) [1])", "(seq-concatenate 'list (bool-vector t nil) '(1))", "(seq-concatenate 'bool-vector (bool-vector t nil) [1])",
  "(seq-concatenate 'string (bool-vector t nil) \"a\")", "(seq-concatenate 'foo [1])", "(seq-concatenate 'string \"a\" [98])", '(seq-position (bool-vector nil t) t)', '(seq-position (bool-vector t nil) nil)',
  '(seq-contains-p (bool-vector nil t) t)', '(seq-contains-p (bool-vector t) nil)', '(seq-empty-p (bool-vector))', '(seq-empty-p (bool-vector t))', '(seq-first (bool-vector t))', '(seq-first (bool-vector))',
  "(seq-some #'identity (bool-vector nil t))", "(seq-some #'identity (bool-vector))", "(seq-every-p #'identity (bool-vector t t))", "(seq-every-p #'identity (bool-vector))", "(seq-find #'identity (bool-vector nil t))",
  "(seq-find #'not (bool-vector t nil nil))", "(seq-do #'ignore (bool-vector nil t))", "(seq-mapn #'list (bool-vector nil t) [1 2])", "(seq-mapn (lambda (a b) (list a b)) (bool-vector t nil) (bool-vector nil t))",
  '(seq-partition (bool-vector t nil t) 2)', '(seq-partition (bool-vector) 2)', '(seq-min (bool-vector t nil))', '(seq-max (bool-vector t nil))', '(seq-min (bool-vector))',
  '(seq-sort (lambda (a b) (and a (not b))) (bool-vector nil t nil))', "(seq-sort #'< (bool-vector))", "(seq-sort-by #'identity #'< (bool-vector))",
  '(seq-map-indexed (lambda (e i) (cons i e)) (bool-vector t nil))', '(seq-do-indexed (lambda (e i) (ignore e i)) (bool-vector t))', '(seq-set-equal-p (bool-vector t) (bool-vector t))',
  '(seq-difference (bool-vector t nil) (bool-vector t))', '(seq-intersection (bool-vector t nil) (bool-vector t))', '(seq-union (bool-vector t nil) (bool-vector t))', "(seq-group-by #'identity (bool-vector t nil t))",
  '(seq-split (bool-vector t nil t) 2)', "(seq-take-while #'identity (bool-vector t nil t))", "(seq-drop-while #'identity (bool-vector t nil t))", "(seq-mapcat #'list (bool-vector t nil))",
  "(seq-keep #'identity (bool-vector t nil t))", '(seq-positions (bool-vector t nil t) t)', '(seq-doseq (x (bool-vector t nil)) (ignore x))', '(let (r) (seq-doseq (x (bool-vector t nil)) (push x r)) r)',
  "(seq-take-while #'identity [t t nil])", "(seq-drop-while #'identity [t t nil])", "(seq-take-while #'identity '(t t nil))", "(seq-drop-while #'identity '(t t nil))", "(seq-take-while #'identity \"abc\")", "(seq-drop-while #'identity \"abc\")",
  // cl-lib
  "(cl-position t (bool-vector nil t))", "(cl-find t (bool-vector nil t))", "(cl-count t (bool-vector nil t t))", "(cl-every #'identity (bool-vector t t))", "(cl-every #'identity (bool-vector))", "(cl-some #'identity (bool-vector nil t))",
  "(cl-reduce (lambda (a b) (or a b)) (bool-vector nil t))", "(cl-reduce #'+ (bool-vector))", '(cl-subseq (bool-vector t nil nil) 1)', '(cl-subseq (bool-vector) 0)',
  "(cl-sort (bool-vector t nil) #'(lambda (a b) (and a (not b))))", "(cl-sort (bool-vector t nil t nil) #'(lambda (a b) (and a (not b))))", "(cl-sort (bool-vector t nil) #'>)", "(cl-find-if #'not (bool-vector t nil))",
  "(cl-count-if #'not (bool-vector t nil))", '(cl-equalp (bool-vector t) (bool-vector t))', '(cl-first (bool-vector t))',
  "(cl-loop for x across (bool-vector t nil t) collect x)", "(cl-loop for x across (bool-vector) collect x)", "(cl-loop for x across (bool-vector t nil t) count x)", "(cl-loop for x across (bool-vector t nil) for i from 0 collect (cons i x))",
  "(cl-loop for x across (make-bool-vector 3 t) sum 1)", "(cl-loop for x in (bool-vector t) collect x)",
];
for (const form of bvForms) CASES.push(bvShow(form));

// the set operations: every length around a byte boundary, with and without DEST, DEST changed and unchanged, and the errors
for (const op of ['union', 'intersection', 'exclusive-or', 'set-difference']) {
  const f = `bool-vector-${op}`;
  for (const n of [0, 1, 3, 7, 8, 9, 16, 17, 20]) {
    CASES.push(bvShow(`(${f} (bv-make ${n} 0) (bv-make ${n} 1))`), bvShow(`(${f} (bv-make ${n} 1) (make-bool-vector ${n} t))`), bvShow(`(${f} (make-bool-vector ${n} t) (make-bool-vector ${n} nil))`));
    CASES.push(bvShow(`(let* ((c (make-bool-vector ${n} nil)) (r (${f} (bv-make ${n} 0) (bv-make ${n} 2) c))) (list r c (eq r c)))`));
    CASES.push(bvShow(`(let* ((c (make-bool-vector ${n} t)) (r (${f} (bv-make ${n} 0) (bv-make ${n} 2) c))) (list r c (eq r c)))`));
    CASES.push(bvShow(`(let* ((a (bv-make ${n} 1)) (r (${f} a a a))) (list r a))`));
    CASES.push(bvShow(`(let* ((a (bv-make ${n} 1)) (c (copy-sequence a)) (r (${f} a (make-bool-vector ${n} nil) c))) (list r c))`));
    CASES.push(bvShow(`(${f} (bv-make ${n} 1) (bv-make ${n} 2) nil)`));
  }
  CASES.push(
    bvShow(`(${f} (bool-vector t nil nil) (bool-vector nil nil))`), bvShow(`(${f} (bool-vector t nil nil) (bool-vector nil nil t) (make-bool-vector 2 nil))`),
    bvShow(`(${f} (bool-vector t nil nil) (bool-vector nil nil t) (make-bool-vector 4 nil))`), bvShow(`(${f} (bool-vector t nil) (bool-vector t) (make-bool-vector 5 nil))`),
    bvShow(`(${f} (bool-vector t nil nil) [t nil nil])`), bvShow(`(${f} [t] (bool-vector t))`), bvShow(`(${f} 1 2)`), bvShow(`(${f} (bool-vector t nil nil) (bool-vector nil nil t) 5)`),
    bvShow(`(${f} (bool-vector t nil nil) (bool-vector nil nil t) [1])`), bvShow(`(${f} (bool-vector t nil) (bool-vector t nil) 'x)`), bvShow(`(${f} (bool-vector t nil) 3 (bool-vector t))`),
    bvShow(`(${f} 3 (bool-vector t) (bool-vector t))`), bvShow(`(${f} (bool-vector t))`), bvShow(`(${f})`), bvShow(`(${f} (bool-vector t) (bool-vector t) (bool-vector t) nil)`),
  );
}
for (const n of [0, 1, 3, 8, 9, 16, 17, 20]) {
  CASES.push(bvShow(`(bool-vector-not (bv-make ${n} 0))`), bvShow(`(bool-vector-not (make-bool-vector ${n} nil))`), bvShow(`(bool-vector-not (make-bool-vector ${n} t))`),
    bvShow(`(let* ((a (bv-make ${n} 1)) (r (bool-vector-not a a))) (list r a (eq r a)))`), bvShow(`(let* ((a (bv-make ${n} 1)) (c (make-bool-vector ${n} t)) (r (bool-vector-not a c))) (list r c (eq r c)))`),
    `(bool-vector-count-population (bool-vector-not (make-bool-vector ${n} nil)))`, `(bool-vector-count-population (bv-make ${n} 0))`, `(bool-vector-count-population (bv-make ${n} 1))`, `(bool-vector-count-population (make-bool-vector ${n} t))`,
    `(bool-vector-subsetp (bv-make ${n} 0) (make-bool-vector ${n} t))`, `(bool-vector-subsetp (make-bool-vector ${n} t) (bv-make ${n} 0))`, `(bool-vector-subsetp (bv-make ${n} 1) (bv-make ${n} 1))`, `(bool-vector-subsetp (bv-make ${n} 1) (bv-make ${n} 2))`,
    `(bool-vector-subsetp (make-bool-vector ${n} nil) (bv-make ${n} 2))`);
}
CASES.push(
  bvShow('(bool-vector-not (bool-vector t nil t) (make-bool-vector 2 nil))'), bvShow('(bool-vector-not [t])'), bvShow('(bool-vector-not (bool-vector t nil) 3)'), bvShow('(bool-vector-not (bool-vector t nil) (make-bool-vector 3 nil))'),
  bvShow('(bool-vector-not)'), bvShow('(bool-vector-not (bool-vector t) nil nil)'), bvShow('(bool-vector-subsetp (bool-vector t t) (bool-vector t nil nil))'), bvShow('(bool-vector-subsetp (bool-vector t nil) (bool-vector t))'),
  bvShow('(bool-vector-subsetp [t] (bool-vector t))'), bvShow('(bool-vector-subsetp (bool-vector t) [t])'), bvShow('(bool-vector-subsetp (bool-vector t))'), bvShow('(bool-vector-subsetp (bool-vector) (bool-vector))'),
  bvShow('(bool-vector-count-population [t])'), bvShow('(bool-vector-count-population (bool-vector))'), bvShow('(bool-vector-count-population (make-bool-vector 100 t))'), bvShow('(bool-vector-count-population)'),
  bvShow('(bool-vector-count-population "a")'), bvShow('(bool-vector-count-population nil)'),
  // bool-vector-count-consecutive: the run of bits equal to B from index I
  bvShow('(bool-vector-count-consecutive (bool-vector t t nil t) t 0)'), bvShow('(bool-vector-count-consecutive (bool-vector t t nil t) nil 2)'), bvShow('(bool-vector-count-consecutive (bool-vector t t nil t) t 3)'),
  bvShow('(bool-vector-count-consecutive (bool-vector t t nil t) t 4)'), bvShow('(bool-vector-count-consecutive (bool-vector t t nil t) t 5)'), bvShow('(bool-vector-count-consecutive (bool-vector t t nil t) t -1)'),
  bvShow("(bool-vector-count-consecutive (bool-vector t t nil t) 'x 0)"), bvShow('(bool-vector-count-consecutive (bool-vector t t nil t) t 1.0)'), bvShow('(bool-vector-count-consecutive (bool-vector t t nil t) t)'),
  bvShow('(bool-vector-count-consecutive (make-bool-vector 100 t) t 0)'), bvShow('(bool-vector-count-consecutive (make-bool-vector 100 t) t 7)'), bvShow('(bool-vector-count-consecutive (make-bool-vector 100 nil) nil 3)'),
  bvShow('(bool-vector-count-consecutive (make-bool-vector 100 nil) t 3)'), bvShow('(bool-vector-count-consecutive [t] t 0)'), bvShow('(bool-vector-count-consecutive (bool-vector) t 0)'), bvShow('(bool-vector-count-consecutive (bool-vector) t 1)'),
  bvShow('(bool-vector-count-consecutive (bool-vector t) nil 0)'), bvShow('(bool-vector-count-consecutive (bool-vector t) t 1)'), bvShow('(bool-vector-count-consecutive (bool-vector t) t 2)'), bvShow('(bool-vector-count-consecutive (bool-vector t) t (expt 2 70))'),
  bvShow('(bool-vector-count-consecutive (bool-vector t) t most-positive-fixnum)'), bvShow('(bool-vector-count-consecutive (bool-vector t) t "a")'), bvShow('(bool-vector-count-consecutive 1 t \'a)'), bvShow('(bool-vector-count-consecutive (bool-vector t t t) t 3)'),
  bvShow('(let ((b (make-bool-vector 40 nil))) (dolist (i \'(3 4 5 6 20 21)) (aset b i t)) (list (bool-vector-count-consecutive b nil 0) (bool-vector-count-consecutive b t 3) (bool-vector-count-consecutive b t 4) (bool-vector-count-consecutive b nil 7) (bool-vector-count-consecutive b t 20) (bool-vector-count-consecutive b nil 22)))'),
);

// programs
CASES.push(
  // the sieve of Eratosthenes to 100
  bvShow('(let* ((n 100) (sieve (make-bool-vector (1+ n) t)) primes) (aset sieve 0 nil) (aset sieve 1 nil) (let ((i 2)) (while (<= (* i i) n) (when (aref sieve i) (let ((j (* i i))) (while (<= j n) (aset sieve j nil) (setq j (+ j i))))) (setq i (1+ i)))) (dotimes (k (1+ n)) (when (aref sieve k) (push k primes))) (list (nreverse primes) (bool-vector-count-population sieve) sieve))'),
  bvShow('(let ((sieve (make-bool-vector 101 t))) (aset sieve 0 nil) (aset sieve 1 nil) (cl-loop for i from 2 to 10 when (aref sieve i) do (cl-loop for j from (* i i) to 100 by i do (aset sieve j nil))) (seq-filter (lambda (i) (aref sieve i)) (number-sequence 0 100)))'),
  // a population count by hand, and against the built-in
  bvShow('(let ((b (bv-make 37 1)) (n 0)) (dotimes (i 37) (when (aref b i) (setq n (1+ n)))) (list n (bool-vector-count-population b) (= n (bool-vector-count-population b))))'),
  bvShow('(let ((b (bv-make 37 0)) (n 0) (i 0)) (while (< i 37) (let ((run (bool-vector-count-consecutive b t i))) (if (> run 0) (setq n (+ n run) i (+ i run)) (setq i (1+ i))))) (list n (bool-vector-count-population b)))'),
  // a set as a bool-vector
  bvShow('(let ((a (bool-vector t t nil nil)) (b (bool-vector t nil t nil))) (list (bool-vector-union a b) (bool-vector-intersection a b) (bool-vector-exclusive-or a b) (bool-vector-set-difference a b) (bool-vector-not a) (bool-vector-subsetp (bool-vector-intersection a b) a)))'),
  bvShow('(let ((b (make-bool-vector 12 nil))) (dolist (i \'(1 3 5 7 9 11)) (aset b i t)) (list b (append b nil) (vconcat b) (mapcar (lambda (x) (if x 1 0)) b) (reverse b) (seq-count #\'identity b)))'),
  // nested in lists and vectors, as hash keys and as the elements of tables
  bvShow('(let ((h (make-hash-table :test \'equal))) (puthash (bool-vector t nil) 1 h) (puthash (list 1 (bool-vector t)) 2 h) (puthash (vector (bool-vector t)) 3 h) (list (gethash (bool-vector t nil) h) (gethash (bool-vector nil t) h) (gethash (list 1 (bool-vector t)) h) (gethash (vector (bool-vector t)) h) (hash-table-count h)))'),
  bvShow('(let ((h (make-hash-table :test \'eq))) (puthash (bool-vector t nil) 1 h) (gethash (bool-vector t nil) h))'),
  bvShow('(let ((h (make-hash-table :test \'eql))) (puthash (bool-vector t nil) 1 h) (gethash (bool-vector t nil) h))'),
  bvShow('(let* ((k (bool-vector t nil)) (h (make-hash-table :test \'eq))) (puthash k 1 h) (gethash k h))'),
  bvShow('(let ((h (make-hash-table :test \'equal))) (puthash (make-bool-vector 9 t) \'a h) (gethash (make-bool-vector 9 t) h))'),
  bvShow('(let ((h (make-hash-table :test \'equal))) (puthash (make-bool-vector 9 t) \'a h) (gethash (make-bool-vector 10 t) h))'),
  bvShow('(equal (list 1 (vector (bool-vector t nil) "s")) (list 1 (vector (bool-vector t nil) "s")))'), bvShow('(equal (list 1 (vector (bool-vector t nil) "s")) (list 1 (vector (bool-vector nil nil) "s")))'),
  bvShow('(list (bool-vector t) (cons (bool-vector nil) (vector (bool-vector t nil t))))'), bvShow('(let ((v (vector (bool-vector t) (bool-vector nil)))) (aset (aref v 0) 0 nil) (aset (aref v 1) 0 t) v)'),
  bvShow('(let ((l (list (bool-vector t nil) (bool-vector nil t)))) (list (mapcar (lambda (b) (bool-vector-count-population b)) l) (apply #\'bool-vector-union l) (seq-reduce #\'bool-vector-union (cdr l) (car l))))'),
  bvShow('(let ((l (list (bool-vector t nil) (bool-vector nil t)))) (delete-dups (append l (list (bool-vector t nil)))))'), bvShow('(let ((al (list (cons (bool-vector t nil) \'a)))) (cdr (assoc (bool-vector t nil) al)))'),
  bvShow('(let ((a (bool-vector t nil))) (list (eq a a) (eq a (copy-sequence a)) (equal a (copy-sequence a))))'),
  bvShow('(let ((b (make-bool-vector 3 nil))) (dotimes (i 3) (aset b i (cl-evenp i))) b)'), bvShow('(cl-loop for i from 0 below 3 collect (make-bool-vector i t))'),
  bvShow('(condition-case e (aset (bool-vector t) 5 t) (args-out-of-range (list \'oops (cdr e))))'), bvShow('(condition-case e (bool-vector-union 1 2) (wrong-type-argument (list \'oops (cdr e))))'),
  bvShow('(condition-case e (bool-vector-union (bool-vector t) (bool-vector t nil)) (wrong-length-argument (list \'oops (cdr e))))'), bvShow('(error-message-string (list \'wrong-length-argument 3 2))'),
  bvShow('(error-message-string (list \'wrong-type-argument \'bool-vector-p [1]))'),
);

// huge or invalid sizes: the error Emacs signals (a size past memory is "Memory exhausted"; sizes of a few billion bits are machine-dependent, so they are not asked)
for (const form of ['(make-bool-vector most-positive-fixnum t)', '(make-bool-vector 1000000000000 t)', '(make-bool-vector 1000000000000000 t)', '(make-bool-vector 36028797018963967 t)', '(make-bool-vector -1 t)', '(make-bool-vector 1.5 t)',
  "(make-bool-vector 'a t)", '(make-bool-vector most-negative-fixnum t)', '(make-bool-vector (expt 2 70) t)', '(make-bool-vector (1+ most-positive-fixnum) t)', '(make-bool-vector (* 8 most-positive-fixnum) t)', '(make-bool-vector 0 t)', '(make-bool-vector 3 t t)']) {
  CASES.push(`(condition-case e ${form} (error (list (car e) (if (stringp (cadr e)) (substring (cadr e) 0 20) (cadr e)) (cddr e))))`);
}

// ---- time functions with their optional arguments
CASES.push('(string-match-p "\\`[0-9]\\{4\\}\\\'" (format-time-string "%Y"))', '(format-time-string "%Y" 0 t)', '(format-time-string "%Y-%m-%d %H:%M:%S" 86400 t)', '(format-time-string "%Y" nil t)', '(format-time-string)', '(format-time-string 1)', '(format-time-string "abc")',
  '(length (decode-time))', '(floatp (float-time))', '(length (current-time))', '(car (decode-time 0 t))');

// ---- text buffers: with-temp-buffer, point, narrowing, searching, replace-match and the line commands (src/elisp-buffer.js)
const W = (s) => `(with-temp-buffer ${s})`;
const T3 = '(insert "alpha\\nbeta\\ngamma\\n")';
const bufferCases = [
  // basics
  W('(list (point) (point-min) (point-max) (buffer-string) (buffer-size))'),
  W('(insert "abc") (list (point) (point-min) (point-max) (buffer-string))'),
  W('(insert "a" ?b "c" 100) (buffer-string)'),
  W('(insert)'), W('(insert 1.5)'), W('(insert nil)'), W('(insert -1)'), W('(insert (list 1))'),
  W(`${T3} (list (goto-char 3) (point))`), W(`${T3} (list (goto-char 100) (point) (goto-char -5) (point))`),
  W('(goto-char "a")'), W('(goto-char 1.0)'), W('(goto-char nil)'),
  W(`${T3} (goto-char 1) (list (forward-char 2) (point) (forward-char) (point) (backward-char 3) (point))`),
  W(`${T3} (goto-char 3) (condition-case e (forward-char 100) (error (list e (point))))`),
  W(`${T3} (goto-char 3) (condition-case e (backward-char 100) (error (list e (point))))`),
  W(`${T3} (goto-char 3) (condition-case e (forward-char -100) (error (list e (point))))`),
  W('(forward-char 1)'), W('(backward-char)'), W('(forward-char "a")'), W('(forward-char 1.5)'),
  W(`${T3} (goto-char 1) (list (forward-line) (point) (forward-line 1) (point) (forward-line 1) (point) (forward-line 1) (point))`),
  W(`${T3} (goto-char 1) (list (forward-line 5) (point))`),
  W(`${T3} (goto-char 8) (list (forward-line 0) (point) (forward-line -1) (point) (forward-line -1) (point) (forward-line -5) (point))`),
  W('(insert "ab") (goto-char 1) (list (forward-line 1) (point))'),
  W('(insert "ab\\ncd") (goto-char 1) (list (forward-line 2) (point))'),
  W('(insert "ab\\ncd") (list (forward-line 1) (point))'),
  W('(list (forward-line 1) (forward-line 0) (forward-line -1) (forward-line 3))'),
  W('(forward-line "x")'), W('(forward-line 1.0)'), W('(forward-line nil)'),
  W(`${T3} (goto-char 8) (list (line-beginning-position) (line-end-position) (pos-bol) (pos-eol) (line-beginning-position 2) (line-end-position 2) (line-beginning-position 0) (line-end-position 0) (line-beginning-position -1) (line-end-position -1) (line-beginning-position 9) (line-end-position 9) (line-end-position -9))`),
  W(`${T3} (goto-char 8) (list (progn (beginning-of-line) (point)) (progn (end-of-line) (point)) (progn (end-of-line 2) (point)) (progn (beginning-of-line 0) (point)) (progn (beginning-of-line 5) (point)))`),
  W(`${T3} (goto-char 1) (list (bolp) (eolp) (bobp) (eobp) (progn (goto-char 6) (list (bolp) (eolp))) (progn (goto-char 3) (list (bolp) (eolp))) (progn (goto-char (point-max)) (list (bolp) (eolp) (bobp) (eobp))))`),
  W('(list (bolp) (eolp) (bobp) (eobp))'),
  W(`${T3} (list (char-after 1) (char-after) (char-after 100) (char-after 0) (char-before 1) (char-before 2) (char-before 100) (char-before) (progn (goto-char 1) (list (following-char) (preceding-char))) (progn (goto-char (point-max)) (list (following-char) (preceding-char))))`),
  W('(insert "📔a") (list (point) (point-max) (char-after 1) (char-before 2) (buffer-substring 1 2) (buffer-size))'),
  W('(insert "📔a\\n📔b") (goto-char 1) (list (re-search-forward "a" nil t) (match-beginning 0) (match-end 0) (point) (line-end-position) (progn (forward-line 1) (point)) (progn (re-search-forward "b") (list (point) (match-beginning 0))))'),
  W('(insert "a📔") (goto-char (point-max)) (list (looking-back "📔" nil) (match-beginning 0) (skip-chars-backward "^a") (point))'),
  W('(insert "📔 journal 📔") (goto-char 1) (list (replace-regexp-in-region "📔" "X") (buffer-string))'),
  W(`${T3} (list (buffer-substring 2 5) (buffer-substring 5 2) (buffer-substring 1 1) (buffer-substring-no-properties 1 3))`),
  W(`${T3} (buffer-substring 0 3)`), W(`${T3} (buffer-substring 3 100)`), W(`${T3} (buffer-substring 100 0)`), W('(buffer-substring "a" 3)'),
  W(`${T3} (list (delete-region 2 4) (buffer-string) (point))`),
  W(`${T3} (goto-char 4) (delete-region 2 6) (list (point) (buffer-string))`),
  W(`${T3} (goto-char 10) (delete-region 6 2) (list (point) (buffer-string))`),
  W(`${T3} (delete-region 0 3)`), W(`${T3} (delete-region 1 100)`),
  W(`${T3} (goto-char 2) (list (delete-char 2) (buffer-string) (point) (delete-char -1) (buffer-string) (point))`),
  W(`${T3} (goto-char 2) (condition-case e (delete-char 100) (error (list e (buffer-string))))`),
  W(`${T3} (goto-char 2) (condition-case e (delete-char -100) (error (list e (buffer-string))))`),
  W('(delete-char 1)'), W('(delete-char "a")'), W('(delete-char 1.0)'),
  W(`${T3} (goto-char 3) (list (erase-buffer) (buffer-string) (point) (point-max))`),
  W(`${T3} (narrow-to-region 3 8) (erase-buffer) (list (buffer-string) (point-min) (point-max))`),
  // narrowing
  W(`${T3} (narrow-to-region 7 12) (list (point) (point-min) (point-max) (buffer-string) (buffer-size) (bobp) (eobp) (progn (goto-char 1) (point)) (progn (goto-char 100) (point)) (char-after 1) (char-after 7) (char-before 7) (char-before 12) (char-after 12) (progn (widen) (list (point-min) (point-max))))`),
  W(`${T3} (narrow-to-region 12 7) (list (point-min) (point-max) (point))`),
  W(`${T3} (list (narrow-to-region 0 5))`), W(`${T3} (narrow-to-region 3 100)`), W('(narrow-to-region "a" 1)'),
  W(`${T3} (goto-char 15) (narrow-to-region 2 6) (point)`),
  W(`${T3} (goto-char 3) (narrow-to-region 6 12) (point)`),
  W(`${T3} (narrow-to-region 7 12) (goto-char 8) (insert "XX") (list (point-min) (point-max) (buffer-string) (progn (widen) (buffer-string)))`),
  W(`${T3} (narrow-to-region 7 12) (goto-char (point-max)) (insert "XX") (list (point-min) (point-max) (buffer-string))`),
  W(`${T3} (narrow-to-region 7 12) (goto-char (point-min)) (insert "XX") (list (point-min) (point-max) (buffer-string))`),
  W(`${T3} (narrow-to-region 7 12) (delete-region 8 10) (list (point-min) (point-max) (buffer-string))`),
  W(`${T3} (narrow-to-region 7 12) (buffer-substring 1 3)`),
  W(`${T3} (narrow-to-region 7 12) (delete-region 1 3)`),
  W(`${T3} (list (save-restriction (narrow-to-region 3 6) (buffer-string)) (point-min) (point-max))`),
  W(`${T3} (narrow-to-region 3 12) (list (save-restriction (narrow-to-region 5 8) (goto-char (point-min)) (insert "ZZ") (buffer-string)) (point-min) (point-max) (buffer-string))`),
  W(`${T3} (narrow-to-region 3 12) (save-restriction (widen) (goto-char (point-max)) (insert "QQ")) (list (point-min) (point-max) (buffer-string))`),
  W(`${T3} (save-restriction (narrow-to-region 3 6) (goto-char (point-max)) (insert "QQ")) (list (point-min) (point-max) (buffer-string))`),
  W(`${T3} (save-restriction (widen) 5)`),
  W(`${T3} (goto-char 3) (list (save-excursion (goto-char 8) (point)) (point))`),
  W(`${T3} (goto-char 8) (save-excursion (goto-char 1) (insert "XX")) (point)`),
  W(`${T3} (goto-char 8) (save-excursion (goto-char 8) (insert "XX")) (point)`),
  W(`${T3} (goto-char 8) (save-excursion (delete-region 2 12)) (point)`),
  W(`${T3} (goto-char 8) (save-excursion (goto-char 3) (delete-region 1 5)) (point)`),
  W(`${T3} (goto-char 8) (save-excursion (delete-region 2 4)) (point)`),
  W(`${T3} (goto-char 8) (list (condition-case nil (save-excursion (goto-char 1) (error "x")) (error (point))) (point))`),
  W(`${T3} (goto-char 8) (save-excursion (goto-char 3) (narrow-to-region 2 5)) (list (point) (point-min) (point-max))`),
  W('(list (current-buffer) (bufferp (current-buffer)) (bufferp 1) (type-of (current-buffer)) (buffer-live-p (current-buffer)))'),
  W('(let ((b (current-buffer))) (insert "a") (list (with-temp-buffer (insert "bb") (list (buffer-string) (eq b (current-buffer)) (with-current-buffer b (buffer-string)))) (buffer-string) (eq b (current-buffer))))'),
  W('(let ((b (current-buffer))) (with-temp-buffer (insert "x") (set-buffer b) (insert "y")) (buffer-string))'),
  W('(let (k) (with-temp-buffer (setq k (current-buffer))) (list (buffer-live-p k) (prin1-to-string k)))'),
  W('(let (k) (with-temp-buffer (setq k (current-buffer))) (with-current-buffer k 1))'),
  W('(with-current-buffer 5 1)'), W('(with-current-buffer "nonesuch-buffer" 1)'), W('(with-current-buffer nil 1)'), W('(set-buffer 5)'), W('(with-temp-buffer)'), W('(with-temp-buffer 1 2 3)'),
  // searching
  W(`${T3} (goto-char 1) (re-search-forward "zzz")`), W(`${T3} (goto-char 1) (re-search-forward "zzz" nil t)`),
  W(`${T3} (goto-char 3) (list (re-search-forward "zzz" nil 'move) (point))`),
  W(`${T3} (goto-char 3) (list (re-search-forward "zzz" 9 'move) (point))`),
  W(`${T3} (goto-char 3) (list (re-search-forward "zzz" 9 'foo) (point))`),
  W(`${T3} (goto-char 3) (list (re-search-forward "a" 7 t) (point))`),
  W(`${T3} (goto-char 3) (list (re-search-forward "a" 9 t) (point))`),
  W(`${T3} (goto-char 3) (re-search-forward "a" 2 t)`),
  W(`${T3} (goto-char 3) (list (re-search-forward "a" 1000 t) (point))`),
  W(`${T3} (goto-char 3) (re-search-forward "a" "x" t)`), W(`${T3} (re-search-forward "a" nil t "x")`), W(`${T3} (re-search-forward "a" nil t 1.0)`), W('(re-search-forward 1)'), W('(re-search-forward nil)'),
  W(`${T3} (goto-char 1) (list (re-search-forward "a" nil t 3) (point) (match-beginning 0))`),
  W(`${T3} (goto-char 1) (list (re-search-forward "a" nil t 9) (point))`),
  W(`${T3} (goto-char 1) (list (re-search-forward "a" nil 'move 9) (point))`),
  W(`${T3} (goto-char 1) (list (re-search-forward "a" nil t 0) (point) (match-beginning 0) (match-end 0))`),
  W(`${T3} (goto-char (point-max)) (list (re-search-forward "a" nil t -1) (point) (match-beginning 0))`),
  W(`${T3} (goto-char (point-max)) (list (re-search-forward "a" nil t -2) (point))`),
  W(`${T3} (goto-char (point-max)) (list (re-search-backward "a" nil t) (point) (match-beginning 0) (match-end 0) (re-search-backward "a" nil t) (point) (re-search-backward "a" nil t) (point))`),
  W(`${T3} (goto-char (point-max)) (list (re-search-backward "a" nil t 2) (point))`),
  W(`${T3} (goto-char (point-max)) (list (re-search-backward "a" nil t -1) (point))`),
  W(`${T3} (goto-char (point-max)) (re-search-backward "zzz")`),
  W(`${T3} (goto-char 8) (list (re-search-backward "zzz" nil 'move) (point))`),
  W(`${T3} (goto-char 12) (list (re-search-backward "a" 8 t) (point))`),
  W(`${T3} (goto-char 12) (re-search-backward "a" 13 t)`),
  W(`${T3} (goto-char 12) (list (re-search-backward "a+" nil t) (match-beginning 0) (match-end 0))`),
  W('(insert "aaa") (goto-char 4) (list (re-search-backward "a+" nil t) (match-beginning 0) (match-end 0))'),
  W('(insert "aaa") (goto-char 3) (list (re-search-backward "a+" nil t) (match-beginning 0) (match-end 0))'),
  W('(insert "foobar") (goto-char 4) (list (re-search-backward "o*" nil t) (point) (match-end 0))'),
  W('(insert "foobar") (goto-char 5) (list (re-search-backward "ob" nil t) (point) (match-end 0))'),
  W('(insert "foobar") (goto-char 1) (list (re-search-forward "o+" 3 t) (point))'),
  W('(insert "foobar") (goto-char 1) (list (re-search-forward "o\\\\{2\\\\}" 4 t) (point))'),
  W('(insert "a\\nb\\n") (goto-char 1) (list (re-search-forward "^b$" nil t) (re-search-forward "^$" nil t) (point))'),
  W('(insert "a\\nb\\n") (goto-char 1) (list (re-search-forward "a$" nil t) (re-search-forward "^" nil t) (point) (re-search-forward "^" nil t) (point))'),
  W('(insert "ab") (goto-char 1) (list (re-search-forward "b$" 3 t) (re-search-forward "\\\\`a" nil t) (point))'),
  W('(insert "ab\\ncd") (goto-char 2) (list (re-search-forward "$" nil t) (point) (re-search-forward "\\\\\'" nil t) (point))'),
  W('(insert "ab\\ncd") (goto-char 1) (list (re-search-forward "b\\\\\'" 3 t) (re-search-forward "b$" 3 t) (point))'),
  W('(insert "ab\\ncd") (goto-char 1) (list (re-search-forward "a.*" nil t) (match-end 0) (re-search-forward ".*" nil t) (point))'),
  W('(insert "Hello hello HELLO") (goto-char 1) (list (re-search-forward "hello" nil t) (re-search-forward "hello" nil t) (let ((case-fold-search nil)) (goto-char 1) (re-search-forward "hello" nil t)))'),
  W('(insert "Hello hello") (goto-char 1) (list (re-search-forward "Hello" nil t) (progn (goto-char 1) (search-forward "HELLO" nil t)))'),
  W('(insert "a.b") (goto-char 1) (list (search-forward "." nil t) (point))'),
  W('(insert "a.b.c") (goto-char 1) (list (search-forward "." nil t 2) (point) (search-backward "." nil t) (point) (match-beginning 0) (match-end 0) (search-backward "." nil t) (point))'),
  W('(insert "abc") (goto-char 1) (list (search-forward "" nil t) (point) (match-beginning 0) (match-end 0))'),
  W('(insert "abc") (goto-char 2) (list (re-search-forward "" nil t) (point) (match-beginning 0))'),
  W('(insert "abc") (goto-char 2) (list (re-search-backward "" nil t) (point))'),
  W('(insert "abc") (goto-char 1) (search-forward "x")'), W('(search-forward 1)'), W('(search-backward "x")'),
  W('(insert "abc") (goto-char 1) (search-forward "c" 2 t)'),
  W('(insert "abc") (goto-char 1) (list (search-forward "c" 3 t) (point))'),
  W('(insert "abc") (goto-char 1) (list (search-forward "bc" 3 t) (point))'),
  W('(insert "abc") (goto-char 1) (list (search-forward "bc" 3 \'move) (point))'),
  W('(insert "foo bar foo") (goto-char 1) (list (re-search-forward "\\\\(fo+\\\\) \\\\(bar\\\\)" nil t) (match-beginning 1) (match-end 1) (match-beginning 2) (match-end 2) (match-string 1) (match-string 2) (match-string 3) (match-beginning 3) (match-data t))'),
  W('(insert "foo bar") (goto-char 1) (list (re-search-forward "\\\\(x\\\\)?bar" nil t) (match-beginning 1) (match-string 1) (match-beginning 0) (match-data t))'),
  W('(insert "foo bar") (list (string-match "o+" "xooy") (match-beginning 0) (match-string 0 "xooy"))'),
  W('(insert "foo bar") (goto-char 1) (re-search-forward "o+") (string-match "b" "abc") (list (match-beginning 0) (match-string 0 "abc"))'),
  W('(insert "foo bar") (goto-char 1) (re-search-forward "o+") (match-string 5)'),
  W('(insert "foo bar") (goto-char 1) (re-search-forward "o+") (match-string 1.0)'),
  W('(re-search-forward "\\\\(")'), W('(re-search-forward "[a")'), W('(insert "a") (goto-char 1) (re-search-forward "\\\\(")'),
  W('(insert "aXb") (goto-char 1) (list (re-search-forward "x" nil t) (let ((case-fold-search nil)) (goto-char 1) (re-search-forward "x" nil t)))'),
  W('(insert "foo  \\t bar") (goto-char 4) (list (skip-chars-forward " \\t") (point) (skip-chars-backward " \\t") (point) (skip-chars-forward "a-z") (point) (skip-chars-forward "^b") (point) (skip-chars-forward "b-z" 5) (point))'),
  W('(insert "abc123 x") (goto-char 1) (list (skip-chars-forward "[:alpha:]") (skip-chars-forward "[:digit:]") (skip-chars-forward "[:space:]") (point) (skip-chars-backward "^a-c") (point))'),
  W('(insert "a-b]c^d\\\\e") (goto-char 1) (list (skip-chars-forward "a\\\\-b") (point) (skip-chars-forward "]c^") (point) (skip-chars-forward "\\\\^d\\\\\\\\") (point))'),
  W('(insert "abc") (goto-char 1) (list (skip-chars-forward "a-c" 2) (point) (skip-chars-forward "a-c" 0) (point) (skip-chars-forward "a-c" 100) (point) (skip-chars-backward "a-c" 100) (point))'),
  W('(skip-chars-forward 1)'), W('(skip-chars-forward "[:nonesuch:]")'), W('(skip-chars-forward "")'), W('(skip-chars-forward "^")'),
  // looking-at
  W('(insert "foo bar") (goto-char 5) (list (looking-at "bar") (match-beginning 0) (match-end 0) (looking-at "ba\\\\(r\\\\)") (match-beginning 1) (looking-at "foo") (looking-at-p "bar") (looking-at "xx") (match-beginning 0))'),
  W('(insert "foo bar") (goto-char 1) (list (looking-at "foo\\\\|bar") (looking-at "") (match-end 0) (looking-at "FOO") (let ((case-fold-search nil)) (looking-at "FOO")))'),
  W('(insert "ab\\ncd") (goto-char 3) (list (looking-at "$") (looking-at "\\n") (looking-at "^") (goto-char 4) (looking-at "^cd") (looking-at "\\\\`cd"))'),
  W('(insert "ab") (goto-char 3) (list (looking-at "") (looking-at "$") (looking-at "\\\\\'"))'),
  W('(insert "foo bar") (goto-char 1) (narrow-to-region 1 3) (list (looking-at "foo") (looking-at "fo$") (looking-at "fo\\\\\'"))'),
  W('(looking-at 1)'), W('(looking-at "\\\\(")'),
  W('(insert "foo bar") (list (looking-back "bar" nil) (match-beginning 0) (looking-back "ba" nil) (looking-back "o b" nil) (looking-back "[a-z]+" nil) (match-beginning 0) (looking-back "[a-z]+" nil t) (match-beginning 0) (looking-back "[a-z]+" 6) (match-beginning 0) (looking-back "xx"))'),
  W('(insert "foo bar") (goto-char 1) (list (looking-back "foo") (looking-back "") (match-beginning 0))'),
  W('(insert "foo bar") (looking-back "bar" 100)'),
  W('(insert "foo bar") (list (looking-back "\\\\(b\\\\)ar") (match-beginning 1) (match-end 1) (point))'),
  // replace-match
  W('(insert "foo bar") (goto-char 1) (re-search-forward "bar") (list (replace-match "baz") (buffer-string) (point) (match-beginning 0) (match-end 0))'),
  W('(insert "foo bar") (goto-char 1) (re-search-forward "o+") (list (replace-match "0") (buffer-string) (point) (match-beginning 0) (match-end 0))'),
  W('(insert "foo bar baz") (goto-char 1) (re-search-forward "\\\\(b\\\\)\\\\(a\\\\)r") (list (replace-match "<\\\\2\\\\1\\\\&\\\\\\\\>") (buffer-string) (point) (match-data t))'),
  W('(insert "foo bar") (goto-char 1) (re-search-forward "\\\\(b\\\\)\\\\(a\\\\)r") (replace-match "X" nil nil nil 2) (list (buffer-string) (point) (match-data t))'),
  W('(insert "foo bar") (goto-char 1) (re-search-forward "\\\\(b\\\\)\\\\(a\\\\)r") (replace-match "XYZ" nil nil nil 1) (list (buffer-string) (point) (match-data t))'),
  W('(insert "foo bar") (goto-char 1) (re-search-forward "\\\\(x\\\\)?bar") (replace-match "Q" nil nil nil 1)'),
  W('(insert "foo bar") (goto-char 1) (re-search-forward "bar") (replace-match "Q" nil nil nil 5)'),
  W('(insert "foo bar") (goto-char 1) (re-search-forward "bar") (replace-match "Q" nil nil nil 40)'),
  W('(insert "foo bar") (goto-char 1) (re-search-forward "bar") (replace-match "Q" nil nil nil -1)'),
  W('(replace-match "x")'), W('(insert "a") (goto-char 1) (re-search-forward "a") (replace-match 1)'),
  W('(insert "foo bar") (goto-char 1) (re-search-forward "bar") (replace-match "a\\\\1b")'),
  W('(insert "foo bar") (goto-char 1) (re-search-forward "bar") (replace-match "a\\\\xb")'),
  W('(insert "foo bar") (goto-char 1) (re-search-forward "bar") (replace-match "a\\\\")'),
  W('(insert "foo bar") (goto-char 1) (re-search-forward "bar") (replace-match "a\\\\?b") (buffer-string)'),
  W('(insert "foo bar") (goto-char 1) (re-search-forward "bar") (replace-match "a\\\\1b" nil t) (buffer-string)'),
  W('(insert "Foo FOO foo") (goto-char 1) (list (re-search-forward "foo") (replace-match "bar") (re-search-forward "foo") (replace-match "bar") (re-search-forward "foo") (replace-match "bar") (buffer-string))'),
  W('(insert "Foo FOO foo") (goto-char 1) (list (re-search-forward "foo") (replace-match "bar" t) (re-search-forward "foo") (replace-match "bar" t) (buffer-string))'),
  W('(insert "Foo Bar FOO BAR") (goto-char 1) (re-search-forward "foo bar") (replace-match "ab cd") (re-search-forward "foo bar") (replace-match "ab cd") (buffer-string)'),
  W('(insert "Foo Bar") (goto-char 1) (re-search-forward "foo bar") (replace-match "ab cd" nil) (buffer-string)'),
  W('(insert "A") (goto-char 1) (re-search-forward "a") (replace-match "xyz") (buffer-string)'),
  W('(insert "AB") (goto-char 1) (re-search-forward "ab") (replace-match "xyz") (buffer-string)'),
  W('(insert "Ab") (goto-char 1) (re-search-forward "ab") (replace-match "xyz") (buffer-string)'),
  W('(insert "a1") (goto-char 1) (re-search-forward "a1") (replace-match "xyz") (buffer-string)'),
  W('(insert "foo bar") (goto-char 1) (re-search-forward "bar") (replace-match "") (list (buffer-string) (point))'),
  W('(insert "foo bar") (goto-char 1) (re-search-forward "o") (re-search-forward "o") (replace-match "a\\nb") (list (buffer-string) (point))'),
  W('(insert "a📔b") (goto-char 1) (re-search-forward "📔") (replace-match "XX📔") (list (buffer-string) (point) (match-end 0))'),
  W('(insert "foo bar foo") (goto-char 1) (re-search-forward "foo") (replace-match "x") (re-search-forward "foo") (replace-match "y") (buffer-string)'),
  W('(insert "foo bar") (goto-char 1) (re-search-forward "bar") (narrow-to-region 1 6) (replace-match "X")'),
  W('(insert "aaa") (goto-char 1) (list (replace-regexp-in-region "a" "bb") (buffer-string) (point))'),
  W('(insert "aaa aaa") (goto-char 1) (list (replace-regexp-in-region "a" "b" 1 4) (buffer-string) (point))'),
  W('(insert "aaa aaa") (goto-char 3) (list (replace-regexp-in-region "a" "bb") (buffer-string) (point))'),
  W('(insert "aaa") (goto-char 1) (list (replace-regexp-in-region "x" "bb") (buffer-string))'),
  W('(insert "Aaa") (goto-char 1) (list (replace-regexp-in-region "a" "bb") (buffer-string))'),
  W('(insert "foo-bar") (goto-char 1) (list (replace-regexp-in-region "\\\\(o+\\\\)-\\\\(b\\\\)" "\\\\2-\\\\1") (buffer-string))'),
  W('(insert "abc") (replace-regexp-in-region "b" "x" 0 3)'), W('(insert "abc") (replace-regexp-in-region "b" "x" 1 9)'),
  W('(insert "a.b.c") (goto-char 1) (list (replace-string-in-region "." "::") (buffer-string) (point))'),
  W('(insert "a.b.c") (goto-char 1) (list (replace-string-in-region "." "\\\\&") (buffer-string))'),
  W('(insert "a.b.c") (goto-char 1) (list (replace-string-in-region "." "-" 1 4) (buffer-string))'),
  W('(insert "a.b.c") (goto-char 1) (list (replace-string-in-region "z" "-") (buffer-string))'),
  W('(insert "aXb") (goto-char 1) (list (replace-string-in-region "x" "-") (buffer-string))'),
  W('(insert "a.b.c") (replace-string-in-region "." "-" 1 90)'), W('(insert "a.b.c") (replace-string-in-region "." "-" 0)'),
  W('(insert "a.b.c") (goto-char 1) (narrow-to-region 2 5) (list (replace-string-in-region "." "--" 1) (buffer-string))'),
  // lines
  W('(insert "a1\\nb2\\na3\\nc4\\n") (goto-char 1) (list (flush-lines "a") (buffer-string) (point))'),
  W('(insert "a1\\nb2\\na3\\nc4\\n") (goto-char 4) (list (flush-lines "a") (buffer-string) (point))'),
  W('(insert "a1\\nb2\\na3\\nc4\\n") (goto-char 2) (list (flush-lines "a") (buffer-string) (point))'),
  W('(insert "a1\\nb2\\na3\\nc4\\n") (goto-char 2) (list (flush-lines "1") (buffer-string) (point))'),
  W('(insert "a1\\nb2\\na3\\nc4") (goto-char 1) (list (flush-lines "4") (buffer-string) (point))'),
  W('(insert "a1\\nb2\\na3\\nc4") (goto-char 1) (list (flush-lines "^$") (buffer-string))'),
  W('(insert "a1\\n\\nb2\\n\\n") (goto-char 1) (list (flush-lines "^$") (buffer-string))'),
  W('(insert "a1\\n\\nb2\\n\\n") (goto-char 1) (list (flush-lines "^[ \\t]*$") (buffer-string))'),
  W('(insert "a1\\nb2\\na3\\nc4\\n") (goto-char 1) (list (flush-lines "a" 1 6) (buffer-string))'),
  W('(insert "a1\\nb2\\na3\\nc4\\n") (goto-char 1) (list (flush-lines "a" 6 1) (buffer-string))'),
  W('(insert "a1\\nb2\\na3\\nc4\\n") (goto-char 1) (list (flush-lines "a" 4 9) (buffer-string))'),
  W('(insert "a1\\nb2\\na3\\nc4\\n") (goto-char 1) (list (flush-lines "a" 3) (buffer-string))'),
  W('(insert "a1\\nb2\\na3\\nc4\\n") (goto-char 1) (list (flush-lines "a" nil 3) (buffer-string))'),
  W('(insert "a1\\nb2\\nA3\\nc4\\n") (goto-char 1) (list (flush-lines "a") (buffer-string))'),
  W('(insert "a1\\nb2\\nA3\\nc4\\n") (goto-char 1) (list (flush-lines "A") (buffer-string))'),
  W('(insert "a1\\nb2\\nA3\\nc4\\n") (goto-char 1) (list (flush-lines "\\\\Ab") (buffer-string))'),
  W('(insert "a1\\nb2\\nA3\\nc4\\n") (goto-char 1) (list (let ((case-fold-search nil)) (flush-lines "a")) (buffer-string))'),
  W('(insert "a1\\nb2\\nA3\\nc4\\n") (goto-char 1) (list (let ((search-upper-case nil)) (flush-lines "A")) (buffer-string))'),
  W('(insert "ab\\ncd\\nef\\n") (goto-char 1) (list (flush-lines "b\\\\(\\n\\\\)c") (buffer-string))'),
  W('(insert "ab\\ncd\\nef\\n") (goto-char 1) (list (flush-lines "b\\nc") (buffer-string))'),
  W('(insert "x\\nx\\nx\\n") (goto-char 1) (list (flush-lines "x\\nx") (buffer-string))'),
  W('(insert "ab") (goto-char 1) (list (flush-lines "") (buffer-string))'),
  W('(insert "ab\\ncd\\n") (goto-char 1) (list (flush-lines "") (buffer-string))'),
  W('(insert "ab\\ncd\\n") (goto-char 1) (list (flush-lines "x*") (buffer-string))'),
  W('(insert "ab\\ncd\\n") (narrow-to-region 1 6) (goto-char 1) (list (flush-lines "c") (buffer-string) (progn (widen) (buffer-string)))'),
  W('(flush-lines 1)'), W('(flush-lines "\\\\(")'),
  W('(insert "a1\\nb2\\na3\\nc4\\n") (goto-char 1) (list (keep-lines "a") (buffer-string) (point))'),
  W('(insert "a1\\nb2\\na3\\nc4\\n") (goto-char 4) (list (keep-lines "a") (buffer-string) (point))'),
  W('(insert "a1\\nb2\\na3\\nc4\\n") (goto-char 2) (list (keep-lines "a") (buffer-string) (point))'),
  W('(insert "a1\\nb2\\na3\\nc4\\n") (goto-char 1) (list (keep-lines "b") (buffer-string) (point))'),
  W('(insert "a1\\nb2\\na3\\nc4\\n") (goto-char 1) (list (keep-lines "zzz") (buffer-string) (point))'),
  W('(insert "a1\\nb2\\na3\\nc4") (goto-char 1) (list (keep-lines "4") (buffer-string) (point))'),
  W('(insert "a1\\nb2\\na3\\nc4\\n") (goto-char 1) (list (keep-lines "a" 1 6) (buffer-string))'),
  W('(insert "a1\\nb2\\na3\\nc4\\n") (goto-char 1) (list (keep-lines "3" 4 9) (buffer-string))'),
  W('(insert "a1\\nb2\\na3\\nc4\\n") (goto-char 1) (list (keep-lines "^" 4 9) (buffer-string))'),
  W('(insert "a1\\nb2\\na3\\nc4\\n") (goto-char 1) (list (keep-lines "") (buffer-string))'),
  W('(insert "a1\\nb2\\na3\\nc4\\n") (goto-char 1) (list (keep-lines "^$") (buffer-string))'),
  W('(insert "a1\\n\\nb2\\n") (goto-char 1) (list (keep-lines "^$") (buffer-string))'),
  W('(insert "a1\\nb2\\nA3\\nc4\\n") (goto-char 1) (list (keep-lines "a") (buffer-string))'),
  W('(insert "a1\\nb2\\nA3\\nc4\\n") (goto-char 1) (list (keep-lines "A") (buffer-string))'),
  W('(insert "ab\\ncd\\nef\\n") (goto-char 1) (list (keep-lines "b\\nc") (buffer-string))'),
  W('(insert "x1\\nx2\\n") (goto-char 1) (list (keep-lines "x") (buffer-string))'),
  W('(insert "a\\nb\\nc\\nd\\n") (goto-char 1) (list (keep-lines "[bc]") (buffer-string))'),
  W('(insert "a\\nb\\nc\\nd\\n") (goto-char 3) (list (keep-lines "[bc]") (buffer-string) (point))'),
  W('(insert "a\\nb\\nc\\nd\\n") (goto-char 5) (list (keep-lines "[bd]") (buffer-string) (point))'),
  W('(insert "a1\\nb2\\na3\\nc4\\n") (goto-char 1) (list (how-many "a") (point))'),
  W('(insert "a1\\nb2\\na3\\nc4\\n") (goto-char 5) (list (how-many "a") (point))'),
  W('(insert "aaa") (goto-char 1) (list (how-many "a") (how-many "a" 2) (how-many "a" 1 3) (how-many "a" 3 1) (how-many "^"))'),
  W('(insert "ab\\ncd\\n") (goto-char 1) (list (how-many "^") (how-many "$") (how-many "x*") (how-many "") (how-many "^$"))'),
  W('(insert "ab\\ncd") (goto-char 1) (list (how-many "^") (how-many "$") (how-many "x*") (how-many "\\\\\'"))'),
  W('(insert "Aa") (goto-char 1) (list (how-many "a") (how-many "A") (how-many "[[:upper:]]") (how-many "[[:lower:]]"))'),
  W('(insert "a\\nb\\n\\n") (list (count-lines 1 (point-max)) (count-lines 1 3) (count-lines 1 2) (count-lines 3 1) (count-lines 2 2) (count-lines 1 1) (count-lines 1 5) (count-lines 4 6))'),
  W('(insert "a\\nb") (list (count-lines 1 (point-max)) (count-lines 2 (point-max)) (count-lines 1 0))'),
  W('(insert "a\\nb") (narrow-to-region 2 4) (list (count-lines 1 4) (count-lines 1 100))'),
  W('(count-lines "a" 1)'),
  W('(insert "a\\nb\\nc") (list (line-number-at-pos) (line-number-at-pos 1) (line-number-at-pos 3) (line-number-at-pos 5) (line-number-at-pos (point-max)) (progn (goto-char 3) (line-number-at-pos)))'),
  W('(insert "a\\nb\\nc") (list (line-number-at-pos 0))'), W('(insert "a\\nb\\nc") (list (line-number-at-pos 100))'),
  W('(insert "a\\nb\\nc") (narrow-to-region 3 6) (list (line-number-at-pos) (line-number-at-pos 5) (line-number-at-pos 5 t) (line-number-at-pos 1) (line-number-at-pos 1 t) (line-number-at-pos 100))'),
  W('(line-number-at-pos "a")'), W('(line-number-at-pos 1.0)'),
  // misc
  '(with-temp-buffer (insert "ab") (buffer-string))', '(progn (insert "ab") (buffer-string))', '(progn (insert "ab") (list (point) (point-max)))', '(point)',
  '(list (with-temp-buffer (insert "a") 1) (buffer-string))',
  W('(list (condition-case e (with-temp-buffer (insert "xx") (error "inner")) (error (cadr e))) (buffer-string))'),
  W('(insert "foo") (let ((b (current-buffer))) (with-temp-buffer (insert "bar") (list (buffer-string) (with-current-buffer b (buffer-string)) (buffer-string))))'),
  W('(insert "abc") (goto-char 1) (list (re-search-forward "b" nil t) (looking-at "c") (progn (goto-char 1) (while (re-search-forward "[a-c]" nil t) (replace-match "x")) (buffer-string)))'),
  W('(insert "k1=v1;k2=v2") (goto-char 1) (let (r) (while (re-search-forward "\\\\([a-z0-9]+\\\\)=\\\\([a-z0-9]+\\\\)" nil t) (push (cons (match-string 1) (match-string 2)) r)) (nreverse r))'),
  W('(insert (format "%s-%d" "a" 3) (make-string 3 ?x) "\\n") (buffer-string)'),
  W('(dotimes (i 3) (insert (number-to-string i) ",")) (buffer-string)'),
  W('(insert "x") (insert "") (list (point) (insert "y" "") (point))'),
  W('(insert "ab") (goto-char 1) (insert "X") (list (point) (buffer-string))'),
  W('(insert "ab") (goto-char 2) (list (insert "X") (point) (buffer-string))'),
  W('(insert "one two\\n  three\\n\\nfour") (goto-char 1) (list (forward-line 1) (point) (looking-at "[ \\t]*") (match-end 0) (skip-chars-forward " ") (point) (progn (end-of-line) (point)) (forward-line 2) (point) (eobp) (forward-line 1) (point))'),
];

CASES.push(...bufferCases);
