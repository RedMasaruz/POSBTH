from html.parser import HTMLParser

class TagValidator(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []
        self.errors = []
        # Void tags that don't need closing
        self.void_tags = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

    def handle_starttag(self, tag, attrs):
        if tag not in self.void_tags:
            self.stack.append((tag, self.getpos()))

    def handle_endtag(self, tag):
        if tag in self.void_tags:
            return

        if not self.stack:
            self.errors.append(f"Unexpected closing tag </{tag}> based at line {self.getpos()[0]}")
            return

        last_tag, pos = self.stack[-1]
        if last_tag == tag:
            self.stack.pop()
        else:
            # Try to find the tag in the stack (handling unclosed nested tags)
            found = False
            for i in range(len(self.stack) - 1, -1, -1):
                if self.stack[i][0] == tag:
                    # Found match, everything after it was unclosed
                    for j in range(len(self.stack) - 1, i, -1):
                        unclosed, unclosed_pos = self.stack[j]
                        self.errors.append(f"Unclosed tag <{unclosed}> starting at line {unclosed_pos[0]}")
                    self.stack = self.stack[:i] # Pop everything up to matched tag
                    found = True
                    break
            
            if not found:
                 self.errors.append(f"Unexpected closing tag </{tag}> at line {self.getpos()[0]}. Expected </{last_tag}>")

    def validate(self, filename):
        with open(filename, 'r') as f:
            self.feed(f.read())
        
        if self.stack:
            for tag, pos in self.stack:
                self.errors.append(f"Unclosed tag <{tag}> starting at line {pos[0]}")
        
        return self.errors

validator = TagValidator()
errors = validator.validate('public/admin.html')

if errors:
    print("HTML Validation Errors:")
    for e in errors:
        print(e)
else:
    print("HTML Structure seems valid.")
